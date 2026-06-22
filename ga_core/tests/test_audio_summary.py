"""audio_summary 端到端测试 - R58-B
验证完整流水线: ffmpeg切片 → sherpa-onnx ASR → 输出结构
使用 do_llm=False 跳过本地LLM依赖, 专注验证ASR管线正确性。
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'memory'))

import pytest
import wave
import numpy as np

GA_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_WAV = os.path.join(GA_ROOT, 'tests', 'test_audio_2spk.wav')
FFMPEG = os.path.join(GA_ROOT, 'temp', 'portable', 'bin', 'ffmpeg.exe')
SHERPA_MODEL = os.path.join(GA_ROOT, 'temp', 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17')

# Skip all tests if core dependencies missing
pytestmark = pytest.mark.skipif(
    not os.path.exists(FFMPEG) or not os.path.exists(SHERPA_MODEL),
    reason='ffmpeg or sherpa model not available'
)


@pytest.fixture
def test_wav():
    """Ensure test WAV exists (2s, 16kHz, mono, two tones)"""
    if not os.path.exists(TEST_WAV):
        # Generate on the fly
        sr = 16000
        t = np.linspace(0, 2.0, sr * 2, endpoint=False)
        signal = np.zeros_like(t)
        half = len(t) // 2
        signal[:half] = 0.5 * np.sin(2 * np.pi * 440 * t[:half])
        signal[half:] = 0.5 * np.sin(2 * np.pi * 880 * t[half:])
        audio = (signal * 32767).astype(np.int16)
        os.makedirs(os.path.dirname(TEST_WAV), exist_ok=True)
        with wave.open(TEST_WAV, 'w') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sr)
            wf.writeframes(audio.tobytes())
    return TEST_WAV


class TestAudioSummaryImport:
    """模块导入和常量验证"""

    def test_import(self):
        import audio_summary
        assert hasattr(audio_summary, 'summarize_audio')
        assert hasattr(audio_summary, '_ffmpeg_segment')
        assert hasattr(audio_summary, '_asr_batch')
        assert hasattr(audio_summary, '_diarize')

    def test_constants(self):
        import audio_summary
        assert audio_summary.GA_ROOT == GA_ROOT
        assert 'ffmpeg' in audio_summary.FFMPEG.lower()

    def test_ts_helper(self):
        from audio_summary import _ts
        assert _ts(0) == '00:00'
        assert _ts(65) == '01:05'
        assert _ts(3661) == '61:01'


class TestFFmpegSegment:
    """ffmpeg 切片功能"""

    def test_segment_short_audio(self, test_wav, tmp_path):
        from audio_summary import _ffmpeg_segment
        work_dir = str(tmp_path / 'work')
        wavs = _ffmpeg_segment(test_wav, seg_sec=60, work_dir=work_dir)
        # 2s audio with 60s segments → 1 segment
        assert len(wavs) == 1
        assert os.path.exists(wavs[0])
        # Verify output is valid WAV
        with wave.open(wavs[0], 'rb') as wf:
            assert wf.getnchannels() == 1
            assert wf.getframerate() == 16000
            assert wf.getsampwidth() == 2
            dur = wf.getnframes() / wf.getframerate()
            assert 1.5 < dur < 2.5  # ~2s

    def test_segment_small_chunks(self, test_wav, tmp_path):
        from audio_summary import _ffmpeg_segment
        work_dir = str(tmp_path / 'work2')
        wavs = _ffmpeg_segment(test_wav, seg_sec=1, work_dir=work_dir)
        # 2s audio with 1s segments → 2 segments
        assert len(wavs) == 2


class TestASRBatch:
    """sherpa-onnx ASR 批量转写"""

    def test_asr_single_segment(self, test_wav, tmp_path):
        from audio_summary import _ffmpeg_segment, _asr_batch
        work_dir = str(tmp_path / 'asr_work')
        wavs = _ffmpeg_segment(test_wav, seg_sec=60, work_dir=work_dir)
        segs = _asr_batch(wavs, lang='zh')
        # Structure check
        assert len(segs) == 1
        seg = segs[0]
        assert 'idx' in seg
        assert 'start_sec' in seg
        assert 'end_sec' in seg
        assert 'text' in seg
        assert isinstance(seg['text'], str)
        assert seg['idx'] == 0
        assert seg['start_sec'] == 0.0
        assert seg['end_sec'] > 1.5

    def test_asr_multi_segment(self, test_wav, tmp_path):
        from audio_summary import _ffmpeg_segment, _asr_batch
        work_dir = str(tmp_path / 'asr_work2')
        wavs = _ffmpeg_segment(test_wav, seg_sec=1, work_dir=work_dir)
        segs = _asr_batch(wavs, lang='zh')
        assert len(segs) == 2
        # Verify cumulative timing
        assert segs[0]['start_sec'] == 0.0
        assert segs[1]['start_sec'] == pytest.approx(segs[0]['end_sec'], abs=0.1)


class TestSummarizeAudioE2E:
    """端到端集成测试 (do_llm=False)"""

    def test_full_pipeline_no_llm(self, test_wav, tmp_path):
        from audio_summary import summarize_audio
        work_dir = str(tmp_path / 'e2e')
        result = summarize_audio(test_wav, seg_sec=60, lang='zh',
                                 work_dir=work_dir, do_llm=False, diarize=False)
        # Verify output structure
        assert isinstance(result, dict)
        assert 'markdown' in result
        assert 'asr_segments' in result
        assert 'total_sec' in result
        assert 'timings' in result
        # Content checks
        assert result['total_sec'] > 1.5
        assert len(result['asr_segments']) >= 1
        assert 'ffmpeg' in result['timings']
        assert 'asr' in result['timings']
        assert 'total' in result['timings']
        # Markdown should contain header
        assert '# 音频摘要' in result['markdown']
        assert 'do_llm=False' in result['markdown']

    def test_diarize_graceful_failure(self, test_wav, tmp_path):
        """diarize=True should not crash even if models missing (graceful fallback)"""
        from audio_summary import summarize_audio
        work_dir = str(tmp_path / 'e2e_diar')
        # This should either succeed or gracefully skip diarization
        result = summarize_audio(test_wav, seg_sec=60, lang='zh',
                                 work_dir=work_dir, do_llm=False, diarize=True)
        assert isinstance(result, dict)
        assert 'markdown' in result
        # diarization key may or may not be present depending on model availability

    def test_work_dir_cleanup(self, test_wav, tmp_path):
        """Verify segment WAVs are cleaned up after processing"""
        from audio_summary import summarize_audio
        work_dir = str(tmp_path / 'cleanup')
        summarize_audio(test_wav, seg_sec=60, lang='zh',
                        work_dir=work_dir, do_llm=False, diarize=False)
        # seg_*.wav should be removed
        remaining = [f for f in os.listdir(work_dir) if f.startswith('seg_')]
        assert len(remaining) == 0


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])

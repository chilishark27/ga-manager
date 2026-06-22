"""GA核心模块冒烟测试 - R58-D
验证 agent_loop.py 和 llmcore.py 的导入、关键函数签名、纯函数逻辑。
不涉及网络调用或密钥。
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

# ============ agent_loop.py ============

class TestAgentLoop:
    def test_import(self):
        import agent_loop
        assert hasattr(agent_loop, 'StepOutcome')
        assert hasattr(agent_loop, 'BaseHandler')
        assert hasattr(agent_loop, 'agent_runner_loop')
        assert hasattr(agent_loop, 'try_call_generator')

    def test_step_outcome_dataclass(self):
        from agent_loop import StepOutcome
        s = StepOutcome(data="hello")
        assert s.data == "hello"
        assert s.next_prompt is None
        assert s.should_exit is False

        s2 = StepOutcome(data={"key": "val"}, next_prompt="next", should_exit=True)
        assert s2.should_exit is True
        assert s2.next_prompt == "next"

    def test_base_handler_dispatch_unknown_tool(self):
        from agent_loop import BaseHandler, exhaust
        h = BaseHandler()
        # dispatch unknown tool should yield error message
        gen = h.dispatch("nonexistent_tool", {"arg": 1}, None)
        outputs = []
        try:
            while True:
                outputs.append(next(gen))
        except StopIteration as e:
            result = e.value
        assert "未知工具" in "".join(str(o) for o in outputs) or (result and result.next_prompt and "未知工具" in result.next_prompt)

    def test_json_default(self):
        from agent_loop import json_default
        assert json_default({1, 2, 3}) == [1, 2, 3] or set(json_default({1, 2, 3})) == {1, 2, 3}
        assert json_default(42) == "42"

    def test_get_pretty_json(self):
        from agent_loop import get_pretty_json
        result = get_pretty_json({"key": "value"})
        assert '"key"' in result
        assert '"value"' in result

    def test_exhaust_generator(self):
        from agent_loop import exhaust
        def gen():
            yield 1
            yield 2
            return "final"
        assert exhaust(gen()) == "final"


# ============ llmcore.py ============

class TestLLMCore:
    def test_import_no_crash(self):
        """Import llmcore without triggering mykeys load (lazy via __getattr__)"""
        import llmcore
        assert hasattr(llmcore, 'compress_history_tags')
        assert hasattr(llmcore, 'trim_messages_history')
        assert hasattr(llmcore, 'auto_make_url')

    def test_auto_make_url_basic(self):
        from llmcore import auto_make_url
        # Normal base + path
        assert auto_make_url("https://api.example.com", "chat/completions") == "https://api.example.com/v1/chat/completions"
        # Base already has /v1
        assert auto_make_url("https://api.example.com/v1", "chat/completions") == "https://api.example.com/v1/chat/completions"
        # Base ends with $ (literal URL)
        assert auto_make_url("https://custom.endpoint/generate$", "chat/completions") == "https://custom.endpoint/generate"
        # Base already ends with path
        assert auto_make_url("https://api.example.com/v1/chat/completions", "chat/completions") == "https://api.example.com/v1/chat/completions"

    def test_compress_history_tags_passthrough(self):
        from llmcore import compress_history_tags
        msgs = [{"role": "user", "content": "hello"}, {"role": "assistant", "content": "hi"}]
        # Should not crash, returns messages (may or may not compress based on counter)
        result = compress_history_tags(msgs, force=True)
        assert isinstance(result, list)
        assert len(result) == 2

    def test_compress_history_tags_truncates(self):
        from llmcore import compress_history_tags
        long_think = "<thinking>" + "x" * 2000 + "</thinking>"
        msgs = [
            {"role": "assistant", "content": long_think},
            {"role": "user", "content": "ok"},
            {"role": "assistant", "content": "short"},
        ]
        result = compress_history_tags(msgs, keep_recent=1, max_len=100, force=True)
        # First message should be truncated
        assert len(result[0]["content"]) < len(long_think)

    def test_trim_messages_history_small(self):
        from llmcore import trim_messages_history
        history = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi"},
        ]
        # Small history should not be trimmed (context_win large enough)
        trim_messages_history(history, context_win=100000)
        assert len(history) == 2


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])

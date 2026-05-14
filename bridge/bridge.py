"""
GA Manager Bridge - stdin/stdout JSON-line protocol
Go backend spawns this as subprocess, communicates via pipes.

Protocol:
  stdout (bridge -> Go): {"event": "ready|next|done|error|log", ...}
  stdin  (Go -> bridge): {"cmd": "send|abort|status|switch_llm", ...}
"""
import sys
import os
import json
import time
import threading
import traceback
import argparse
import base64
import tempfile
import uuid
import urllib.request

# --- Fix stdin pipe inheritance ---
# When bridge.py is spawned by Go backend, its stdin is a pipe.
# GA's code_run (subprocess.Popen) doesn't specify stdin, so child processes
# inherit this pipe, causing blocking/contention. Fix: default stdin to DEVNULL.
import subprocess as _subprocess
_OrigPopenInit = _subprocess.Popen.__init__
def _popen_init_no_stdin(self, *args, **kwargs):
    if 'stdin' not in kwargs:
        kwargs['stdin'] = _subprocess.DEVNULL
    _OrigPopenInit(self, *args, **kwargs)
_subprocess.Popen.__init__ = _popen_init_no_stdin

# --- stdout lock for thread-safe JSON line output ---
_stdout_lock = threading.Lock()


def vision_preprocess(images_b64: list, user_text: str, ga_root: str = "") -> str:
    """
    Call Claude API directly to describe images, return text description.
    This avoids GA's multi-turn tool-call approach which causes timeouts.
    Uses OpenAI-compatible endpoint with image_url format.
    """
    # Import mykey config from GA root
    import importlib.util
    mykey_path = os.path.join(ga_root, "mykey.py") if ga_root else ""
    if not mykey_path or not os.path.exists(mykey_path):
        mykey_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "GenericAgent", "mykey.py")
    if not os.path.exists(mykey_path):
        mykey_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "mykey.py")
    if not os.path.exists(mykey_path):
        return f"[图片预处理失败: 找不到mykey.py]\n\n{user_text}"
    
    spec = importlib.util.spec_from_file_location("mykey", mykey_path)
    mykey = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mykey)
    
    # Try multiple config names in priority order (vision-capable models)
    # native_claude_config_* = Claude native format (/messages + x-api-key)
    # native_oai_config_* = OpenAI-compatible format (/chat/completions + Bearer)
    _cfg_names = [
        "native_claude_config_opus47",
        "native_oai_config_opus46_thinking",
        "native_oai_config_opus47",
        "native_oai_config_opus46",
        "native_oai_config_dsv4pro",
    ]
    cfg = None
    cfg_name = ""
    for _name in _cfg_names:
        cfg = getattr(mykey, _name, None)
        if cfg:
            cfg_name = _name
            break
    if not cfg:
        return f"[图片预处理失败: mykey.py中未找到vision配置({','.join(_cfg_names)})]\n\n{user_text}"
    
    apikey = cfg.get("apikey", "")
    apibase = cfg.get("apibase", "").rstrip("/")
    model = cfg.get("model", "claude-sonnet-4-20250514")
    is_claude_native = cfg_name.startswith("native_claude_config_")
    
    # Detect media type from base64 data
    def _detect_media_type(img_b64: str) -> tuple:
        """Returns (media_type, raw_base64)"""
        if "," in img_b64:
            # Has data URL prefix like "data:image/png;base64,xxxx"
            parts = img_b64.split(",", 1)
            mt = parts[0].split(":")[1].split(";")[0] if ":" in parts[0] else "image/png"
            return mt, parts[1]
        try:
            header = base64.b64decode(img_b64[:16])
            if header[:2] == b'\xff\xd8':
                return "image/jpeg", img_b64
            elif header[:4] == b'\x89PNG':
                return "image/png", img_b64
            elif header[:4] == b'GIF8':
                return "image/gif", img_b64
            elif header[:4] == b'RIFF':
                return "image/webp", img_b64
        except Exception:
            pass
        return "image/png", img_b64
    
    if is_claude_native:
        # Claude native Messages API format
        content_blocks = []
        for img_b64 in images_b64:
            media_type, raw_b64 = _detect_media_type(img_b64)
            content_blocks.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": raw_b64}
            })
        content_blocks.append({"type": "text", "text": user_text or "请详细描述这张图片的内容"})
        
        payload = json.dumps({
            "model": model,
            "max_tokens": 2048,
            "messages": [{"role": "user", "content": content_blocks}]
        }).encode("utf-8")
        
        url = f"{apibase}/v1/messages"
        req = urllib.request.Request(url, data=payload, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("x-api-key", apikey)
        req.add_header("anthropic-version", "2023-06-01")
    else:
        # OpenAI-compatible format
        content_blocks = []
        for img_b64 in images_b64:
            media_type, raw_b64 = _detect_media_type(img_b64)
            data_url = f"data:{media_type};base64,{raw_b64}"
            content_blocks.append({
                "type": "image_url",
                "image_url": {"url": data_url}
            })
        content_blocks.append({"type": "text", "text": user_text or "请详细描述这张图片的内容"})
        
        payload = json.dumps({
            "model": model,
            "max_tokens": 2048,
            "messages": [{"role": "user", "content": content_blocks}]
        }).encode("utf-8")
        
        url = f"{apibase}/v1/chat/completions"
        req = urllib.request.Request(url, data=payload, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {apikey}")
    
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            # Parse response based on API format
            if is_claude_native:
                # Claude Messages API: {"content": [{"type": "text", "text": "..."}]}
                description = result["content"][0]["text"]
            else:
                # OpenAI format: {"choices": [{"message": {"content": "..."}}]}
                description = result["choices"][0]["message"]["content"]
            # Combine: image description + user's original text
            if user_text:
                return f"[用户发送了图片，以下是图片内容描述]\n{description}\n\n[用户附言] {user_text}"
            else:
                return f"[用户发送了图片，以下是图片内容描述]\n{description}\n\n请根据图片内容回复用户。"
    except Exception as e:
        return f"[图片预处理失败: {e}]\n\n{user_text}"


def send(obj: dict):
    """Thread-safe send a JSON line to stdout"""
    line = json.dumps(obj, ensure_ascii=False)
    with _stdout_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def _recover_history(ga_root):
    """Parse the latest model_responses file to recover conversation history."""
    import glob
    mr_dir = os.path.join(ga_root, "temp", "model_responses")
    if not os.path.isdir(mr_dir):
        return []
    files = sorted(glob.glob(os.path.join(mr_dir, "model_responses_*.txt")),
                   key=os.path.getmtime, reverse=True)
    if not files:
        return []
    # Use the most recent file
    latest = files[0]
    history = []
    try:
        with open(latest, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        # Parse === Prompt === and === Response === blocks
        import re
        blocks = re.split(r"=== (Prompt|Response) === [^\n]*\n", content)
        # blocks: ['', 'Prompt', '{...}', 'Response', '{...}', ...]
        i = 1
        while i < len(blocks) - 1:
            block_type = blocks[i]
            block_content = blocks[i + 1].strip()
            if block_type == "Prompt" and block_content:
                try:
                    msg = json.loads(block_content)
                    if isinstance(msg, dict) and msg.get("role"):
                        history.append(msg)
                except (json.JSONDecodeError, ValueError):
                    # Try to extract text content
                    history.append({"role": "user", "content": block_content[:500]})
            elif block_type == "Response" and block_content:
                # Response is typically raw text or list
                text = block_content[:1000]
                if text.startswith("[{"):
                    try:
                        parts = json.loads(text)
                        text = " ".join(p.get("text", "") for p in parts if isinstance(p, dict))
                    except (json.JSONDecodeError, ValueError):
                        pass
                if text:
                    history.append({"role": "assistant", "content": text[:500]})
            i += 2
    except Exception:
        pass
    return history


def main():
    parser = argparse.ArgumentParser(description="GA Bridge subprocess")
    parser.add_argument("--ga-root", required=True, help="Path to GenericAgent root directory")
    parser.add_argument("--llm-no", type=int, default=0, help="LLM slot number")
    parser.add_argument("--name", default="", help="Instance display name")
    parser.add_argument("--autonomous", action="store_true", help="Enable autonomous mode")
    parser.add_argument("--goal", default="", help="Goal prompt")
    parser.add_argument("--recover", action="store_true", help="Recover history from model_responses")
    args = parser.parse_args()

    agent_dir = os.path.abspath(args.ga_root)
    if not os.path.isdir(agent_dir):
        send({"event": "error", "msg": f"Directory not found: {agent_dir}"})
        return

    # Setup environment
    sys.path.insert(0, agent_dir)
    os.chdir(agent_dir)
    os.environ["PYTHONIOENCODING"] = "utf-8"
    os.environ["PYTHONUTF8"] = "1"

    try:
        if hasattr(sys.stdin, "reconfigure"):
            sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    # Import and initialize GA
    try:
        send({"event": "log", "msg": "Importing agentmain..."})
        import agentmain

        send({"event": "log", "msg": "Creating GeneraticAgent instance..."})
        try:
            agent = agentmain.GeneraticAgent()
        except IndexError:
            send({
                "event": "error",
                "msg": "LLM not configured. Please setup mykey.py first."
            })
            return

        # Configure agent
        if args.llm_no > 0:
            agent.next_llm(args.llm_no)
        if args.goal:
            agent.goal = args.goal
        if args.autonomous:
            agent.autonomous = True
        agent.inc_out = False
        agent.peer_hint = False

        # Apply instance isolation (temp dir separation + memory file locking)
        try:
            bridge_dir = os.path.dirname(os.path.abspath(__file__))
            sys.path.insert(0, bridge_dir)
            from instance_isolation import apply_isolation
            apply_isolation(args.name, agent_dir, send_fn=send)
        except Exception as e:
            send({"event": "log", "msg": f"[Isolation] Warning: {e} (continuing without isolation)"})

        # Image support: build multimodal content_blocks in chat handler below

        # Recover history from model_responses if --recover flag
        if args.recover:
            send({"event": "log", "msg": "Recovering history from model_responses..."})
            try:
                recovered = _recover_history(agent_dir)
                if recovered:
                    agent.history = recovered
                    send({"event": "log", "msg": f"Recovered {len(recovered)} messages from model_responses"})
                    # Send recovered messages to frontend as chat history
                    for msg in recovered:
                        role = msg.get("role", "")
                        content = msg.get("content", "")
                        if isinstance(content, list):
                            # Extract text from content blocks
                            content = " ".join(b.get("text", "") for b in content if b.get("type") == "text")
                        if role and content:
                            send({"event": "recovered_msg", "role": role, "content": content[:500]})
                else:
                    send({"event": "log", "msg": "No history to recover"})
            except Exception as e:
                send({"event": "log", "msg": f"Recovery failed (non-fatal): {e}"})

        # Start agent's task consumer thread
        threading.Thread(target=agent.run, daemon=True).start()

        # Build LLM info for frontend
        llm_info = []
        if hasattr(agent, "llmclients"):
            for i, c in enumerate(agent.llmclients):
                name = getattr(c, "model_name", None) or getattr(c, "name", f"LLM-{i}")
                llm_info.append({"idx": i, "name": str(name)})

        send({
            "event": "ready",
            "llms": llm_info,
            "llm_no": getattr(agent, "llm_no", 0),
            "name": args.name,
            "pid": os.getpid(),
        })
    except Exception as e:
        send({"event": "error", "msg": str(e), "trace": traceback.format_exc()[-2000:]})
        return

    # --- Debug file logger ---
    _log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bridge_debug.log")
    def _dbg(msg):
        with open(_log_path, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
            f.flush()
    _dbg(f"bridge started, pid={os.getpid()}, llm_no={args.llm_no}")

    # --- State ---
    start_time = time.time()
    total_turns = 0
    is_busy = False
    pending_queue = []  # Messages queued while busy
    abort_for_supplement = False  # True when aborting to process a supplement
    current_dq = None  # Reference to current display_queue for abort sentinel

    def process_pending():
        """Process next pending message after current task finishes"""
        nonlocal is_busy, total_turns, current_dq
        if not pending_queue:
            return
        queued = pending_queue.pop(0)
        _dbg(f"process_pending: sending queued msg, len={len(queued)}")
        is_busy = True
        total_turns += 1
        try:
            dq = agent.put_task(queued)
            current_dq = dq  # Save reference for abort sentinel
            threading.Thread(target=relay, args=(dq,), daemon=True).start()
        except Exception as e:
            is_busy = False
            send({"event": "error", "msg": f"put_task (queued) failed: {e}"})

    # ── Idle monitor (autonomous mode) ────────────────────
    AUTO_IDLE_THRESHOLD = 1800  # 30 minutes before autonomous trigger
    AUTO_COOLDOWN = 120         # seconds between triggers
    _last_activity = [time.time()]  # mutable: updated on user msg / relay done
    _last_auto_trigger = [0.0]
    _idle_monitor_stop = threading.Event()

    def _update_activity():
        _last_activity[0] = time.time()

    def _idle_monitor():
        """Background thread: check idle every 5s, trigger autonomous if needed"""
        nonlocal is_busy, total_turns, current_dq
        while not _idle_monitor_stop.is_set():
            _idle_monitor_stop.wait(5)
            if _idle_monitor_stop.is_set():
                break
            if not getattr(agent, 'autonomous', False):
                continue
            if is_busy:
                continue
            now = time.time()
            if now - _last_auto_trigger[0] < AUTO_COOLDOWN:
                continue
            idle = now - _last_activity[0]
            if idle > AUTO_IDLE_THRESHOLD:
                _last_auto_trigger[0] = now
                prompt = "[AUTO]🤖 用户已经离开超过30分钟，作为自主智能体，请阅读自动化sop，执行自动任务。"
                _dbg(f"autonomous idle trigger: idle={idle:.0f}s")
                send({"event": "autonomous_fired", "idle": idle})
                is_busy = True
                total_turns += 1
                try:
                    dq = agent.put_task(prompt)
                    current_dq = dq
                    threading.Thread(target=relay, args=(dq,), daemon=True).start()
                except Exception as e:
                    is_busy = False
                    _dbg(f"autonomous: put_task failed: {e}")
                    send({"event": "error", "msg": f"autonomous put_task failed: {e}"})

    threading.Thread(target=_idle_monitor, daemon=True).start()

    # ── Scheduler monitor (reflect/scheduler.py) ────────────────────
    _scheduler_stop = threading.Event()

    def _scheduler_monitor():
        """Background thread: load scheduler.py, call check() every INTERVAL"""
        nonlocal is_busy, total_turns, current_dq
        import importlib.util
        sched_path = os.path.join(agent_dir, 'reflect', 'scheduler.py')
        if not os.path.isfile(sched_path):
            _dbg(f"scheduler: {sched_path} not found, monitor exiting")
            return
        try:
            spec = importlib.util.spec_from_file_location('scheduler_script', sched_path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            _dbg(f"scheduler: loaded, INTERVAL={getattr(mod, 'INTERVAL', 120)}")
        except Exception as e:
            _dbg(f"scheduler: failed to load: {e}")
            return

        interval = getattr(mod, 'INTERVAL', 120)
        while not _scheduler_stop.is_set():
            _scheduler_stop.wait(interval)
            if _scheduler_stop.is_set():
                break
            if not getattr(agent, 'scheduler', False):
                continue
            if is_busy:
                continue
            try:
                task = mod.check()
            except Exception as e:
                _dbg(f"scheduler: check() error: {e}")
                continue
            if task is None:
                continue
            _dbg(f"scheduler: triggered task")
            send({"event": "scheduler_fired", "task": str(task)[:200]})
            is_busy = True
            total_turns += 1
            try:
                dq = agent.put_task(task)
                current_dq = dq
                threading.Thread(target=relay, args=(dq,), daemon=True).start()
            except Exception as e:
                is_busy = False
                _dbg(f"scheduler: put_task failed: {e}")
                send({"event": "error", "msg": f"scheduler put_task failed: {e}"})

    threading.Thread(target=_scheduler_monitor, daemon=True).start()

    # ── Team Worker monitor (reflect/agent_team_worker.py) ────────────────────
    _team_stop = threading.Event()

    def _team_worker_monitor():
        """Background thread: load agent_team_worker.py, call check() every INTERVAL"""
        nonlocal is_busy, total_turns, current_dq
        import importlib.util
        team_path = os.path.join(agent_dir, 'reflect', 'agent_team_worker.py')
        if not os.path.isfile(team_path):
            _dbg(f"team_worker: {team_path} not found, monitor exiting")
            return
        try:
            spec = importlib.util.spec_from_file_location('team_worker_script', team_path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            _dbg(f"team_worker: loaded, INTERVAL={getattr(mod, 'INTERVAL', 60)}")
        except Exception as e:
            _dbg(f"team_worker: failed to load: {e}")
            return

        # Init with config from agent attributes (set via set_config)
        def _do_init():
            cfg = {}
            for k in ('base_url', 'board_key', 'name'):
                v = getattr(agent, f'team_{k}', '') or ''
                if v: cfg[k] = v
            if hasattr(mod, 'init') and cfg:
                mod.init(cfg)
                _dbg(f"team_worker: init({cfg})")

        _do_init()
        interval = getattr(mod, 'INTERVAL', 60)
        while not _team_stop.is_set():
            _team_stop.wait(interval)
            if _team_stop.is_set():
                break
            if not getattr(agent, 'team_worker', False):
                continue
            if is_busy:
                continue
            # Re-init in case config changed
            _do_init()
            try:
                task = mod.check()
            except Exception as e:
                _dbg(f"team_worker: check() error: {e}")
                continue
            if task is None:
                continue
            _dbg(f"team_worker: triggered task")
            send({"event": "team_worker_fired", "task": str(task)[:200]})
            is_busy = True
            total_turns += 1
            try:
                dq = agent.put_task(task, source='reflect')
                current_dq = dq
                threading.Thread(target=relay, args=(dq,), daemon=True).start()
            except Exception as e:
                is_busy = False
                _dbg(f"team_worker: put_task failed: {e}")
                send({"event": "error", "msg": f"team_worker put_task failed: {e}"})
            # on_done callback
            if not _team_stop.is_set() and hasattr(mod, 'on_done'):
                # Wait for relay to finish (is_busy becomes False)
                for _ in range(600):
                    if not is_busy:
                        break
                    time.sleep(0.5)
                try:
                    mod.on_done('')
                except Exception as e:
                    _dbg(f"team_worker: on_done error: {e}")

    threading.Thread(target=_team_worker_monitor, daemon=True).start()

    def relay(dq):
        """Blocking relay: read from display_queue, write to stdout"""
        nonlocal is_busy, total_turns, abort_for_supplement
        _dbg("relay() entered, waiting for dq items...")

        # Heartbeat thread: send periodic heartbeat while relay is active
        heartbeat_stop = threading.Event()
        def _heartbeat():
            while not heartbeat_stop.is_set():
                if heartbeat_stop.wait(30):
                    break
                send({"event": "heartbeat", "ts": int(time.time())})
                _dbg("heartbeat sent")
        hb_thread = threading.Thread(target=_heartbeat, daemon=True)
        hb_thread.start()

        try:
            while True:
                item = dq.get(timeout=600)  # 10min timeout per chunk
                # If abort was triggered for supplement, stop relaying immediately
                if abort_for_supplement:
                    _dbg("relay: abort_for_supplement detected, draining queue...")
                    # Drain remaining items from dq until done/error
                    try:
                        while True:
                            drain = dq.get(timeout=5)
                            if "done" in drain or "error" in drain:
                                break
                    except Exception:
                        pass
                    send({"event": "interrupted", "msg": "已打断，正在处理补充消息..."})
                    _dbg("relay: interrupted event sent")
                    break
                _dbg(f"relay got: keys={list(item.keys())}, preview={str(item)[:300]}")
                if "next" in item:
                    send({"event": "next", "text": item["next"]})
                if "done" in item:
                    text = item["done"]
                    # Estimate tokens: ~1.3 chars per token for mixed zh/en
                    est_tokens = max(10, len(text) * 10 // 13)
                    send({"event": "done", "text": text, "tokens": est_tokens})
                    _dbg(f"relay sent done, len={len(text)}, tokens={est_tokens}")
                    break
        except Exception as e:
            _dbg(f"relay ERROR: {e}")
            if not abort_for_supplement:
                send({"event": "error", "msg": f"relay error: {e}"})
        finally:
            heartbeat_stop.set()
            was_supplement = abort_for_supplement
            abort_for_supplement = False
            is_busy = False
            # Auto-process pending messages (supplement gets priority)
            process_pending()
            # Update activity timestamp so idle monitor resets
            _update_activity()

    def _rebuild_extra_sys_prompt(agent):
        """Sync feature toggle states into agent.llmclient.backend.extra_sys_prompt
        so GA's run() picks them up via: sys_prompt = get_system_prompt() + extra_sys_prompt"""
        parts = []
        if getattr(agent, 'autonomous', False):
            parts.append(
                "\n### 行动规范（持续有效）\n"
                "每次回复（含工具调用轮）都先在回复文字中包含一个<summary></summary> 中输出极简单行（<30字）物理快照：上次结果新信息+本次意图。此内容进入长期工作记忆。\n\n"
                "**若用户需求未完成，必须进行工具调用！**"
            )
        if getattr(agent, 'goal', ''):
            parts.append(f"\n[当前目标] {agent.goal}")
        if getattr(agent, 'reflect', False):
            parts.append(
                "\n[反射模式] 每次行动后自我检查：结果是否符合预期？是否需要修正方向？"
            )
        if getattr(agent, 'peer_hint', False):
            parts.append(
                "\n[Peer] 用户提及其他会话/后台任务状态时: temp/model_responses/ (只找近期修改的文件尾部)\n"
            )
        try:
            agent.llmclient.backend.extra_sys_prompt = '\n'.join(parts)
            _dbg(f"extra_sys_prompt updated, len={len(agent.llmclient.backend.extra_sys_prompt)}")
        except Exception as e:
            _dbg(f"Failed to set extra_sys_prompt: {e}")

    # --- Main stdin command loop ---
    # NOTE: Must use readline() instead of `for line in sys.stdin`
    # because the iterator uses an internal 8KB buffer in pipe mode
    # and won't yield lines until the buffer is full or EOF.
    while True:
        line = sys.stdin.readline()
        if not line:  # EOF - parent process closed stdin
            break
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as e:
            send({"event": "error", "msg": f"Invalid JSON: {e}"})
            continue

        c = cmd.get("cmd", "")

        if c == "send":
            text = str(cmd.get("text", "")).strip()
            if not text:
                send({"event": "error", "msg": "Empty text"})
                continue
            if is_busy:
                # Scheme A: Abort current task, queue supplement, GA will see it fresh
                pending_queue.append(text)
                abort_for_supplement = True
                agent.abort()
                # Put sentinel to wake up relay if it's blocked on dq.get()
                if current_dq is not None:
                    try:
                        current_dq.put({"__abort_sentinel__": True})
                    except Exception:
                        pass
                _dbg(f"Abort for supplement, queue_len={len(pending_queue)}")
                send({"event": "interrupting", "msg": "正在打断当前回复，将结合补充内容重新回复..."})
                continue
            images = cmd.get("images") or []
            # Vision preprocess: call Claude API directly to describe images
            # This avoids GA's multi-turn tool-call approach which causes timeouts
            if images:
                _dbg(f"Vision preprocess: {len(images)} images, calling Claude API...")
                send({"event": "log", "msg": f"正在分析 {len(images)} 张图片..."})
                try:
                    query = vision_preprocess(images, text, ga_root=agent_dir)
                    _dbg(f"Vision preprocess done, result length={len(query)}")
                except Exception as e:
                    _dbg(f"Vision preprocess failed: {e}")
                    query = f"[图片分析失败: {e}]\n\n{text}" if text else f"[图片分析失败: {e}]"
            else:
                query = text
            _update_activity()  # Reset idle timer on user message
            is_busy = True
            total_turns += 1
            try:
                dq = agent.put_task(query)
                current_dq = dq  # Save reference for abort sentinel
                threading.Thread(target=relay, args=(dq,), daemon=True).start()
            except Exception as e:
                is_busy = False
                send({"event": "error", "msg": f"put_task failed: {e}"})

        elif c == "abort":
            if is_busy:
                agent.abort()
                send({"event": "aborted"})
            else:
                send({"event": "error", "msg": "Not busy"})

        elif c == "status":
            send({
                "event": "status",
                "busy": is_busy,
                "pid": os.getpid(),
                "uptime": int(time.time() - start_time),
                "turns": total_turns,
                "llm_no": getattr(agent, "llm_no", 0),
                "autonomous": getattr(agent, "autonomous", False),
                "goal": getattr(agent, "goal", ""),
                "scheduler": getattr(agent, "scheduler", False),
                "peer_hint": getattr(agent, "peer_hint", False),
                "reflect": getattr(agent, "reflect", False),
                "team_worker": getattr(agent, "team_worker", False),
                "verbose": getattr(agent, "verbose", True),
                "supported_commands": [
                    "chat - 发送消息/任务",
                    "abort - 中断当前任务",
                    "status - 查询状态",
                    "switch_llm - 切换LLM(idx)",
                    "set_config - 设置开关(autonomous/goal/peer_hint/reflect/verbose/scheduler/team_worker/team_base_url/team_board_key/team_name)",
                    "ping - 心跳",
                ],
            })

        elif c == "switch_llm":
            idx = int(cmd.get("idx", 0))
            try:
                agent.next_llm(idx)
                send({"event": "ack", "cmd": "switch_llm", "idx": idx})
            except Exception as e:
                send({"event": "error", "msg": f"switch_llm failed: {e}"})

        elif c == "set_config":
            key = cmd.get("key", "")
            value = cmd.get("value")
            allowed = {"autonomous", "goal", "peer_hint", "reflect", "verbose", "scheduler", "team_worker", "team_base_url", "team_board_key", "team_name"}
            if not key:
                pass  # silently ignore empty key
            elif key in allowed:
                setattr(agent, key, value)
                # Rebuild extra_sys_prompt so feature toggles actually take effect
                _rebuild_extra_sys_prompt(agent)
                send({"event": "ack", "cmd": "set_config", "key": key, "value": value})
            else:
                send({"event": "error", "msg": f"Unknown config key: {key}"})

        elif c == "ping":
            send({"event": "pong", "ts": time.time()})

        else:
            send({"event": "error", "msg": f"Unknown cmd: {c}"})


if __name__ == "__main__":
    main()

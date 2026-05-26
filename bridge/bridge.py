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
import urllib.error

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


def vision_preprocess(images_b64: list, user_text: str, ga_root: str = "", llm_client=None) -> str:
    """
    Use GA's own LLM client (raw_ask) to describe images.
    This ensures proxy, auth, and URL are all consistent with normal chat.
    Falls back to urllib if no client available.
    """
    import time as _time
    _vlog = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bridge_debug.log")

    def _detect_media_type(img_b64: str) -> tuple:
        if "," in img_b64:
            parts = img_b64.split(",", 1)
            mt = parts[0].split(":")[1].split(";")[0] if ":" in parts[0] else "image/png"
            return mt, parts[1]
        try:
            header = base64.b64decode(img_b64[:16])
            if header[:2] == b'\xff\xd8': return "image/jpeg", img_b64
            elif header[:4] == b'\x89PNG': return "image/png", img_b64
            elif header[:4] == b'GIF8': return "image/gif", img_b64
            elif header[:4] == b'RIFF': return "image/webp", img_b64
        except Exception:
            pass
        return "image/png", img_b64

    # Compress images to reduce payload size (proxies often have size/timeout limits)
    def _compress_image(img_b64: str, max_size: int = 800) -> str:
        """Resize image if too large, convert to JPEG for smaller payload."""
        try:
            from PIL import Image
            import io
            # Decode
            if "," in img_b64:
                raw = img_b64.split(",", 1)[1]
            else:
                raw = img_b64
            img_data = base64.b64decode(raw)
            img = Image.open(io.BytesIO(img_data))
            # Resize if larger than max_size
            w, h = img.size
            if w > max_size or h > max_size:
                ratio = min(max_size / w, max_size / h)
                img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
            # Convert to JPEG (much smaller than PNG for screenshots)
            if img.mode == 'RGBA':
                bg = Image.new('RGB', img.size, (255, 255, 255))
                bg.paste(img, mask=img.split()[3])
                img = bg
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=75)
            return base64.b64encode(buf.getvalue()).decode('ascii')
        except ImportError:
            return img_b64.split(",", 1)[1] if "," in img_b64 else img_b64
        except Exception:
            return img_b64.split(",", 1)[1] if "," in img_b64 else img_b64

    # Build multimodal message content
    content_blocks = []
    for img_b64 in images_b64:
        compressed = _compress_image(img_b64)
        content_blocks.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/jpeg", "data": compressed}
        })
    content_blocks.append({"type": "text", "text": user_text or "请详细描述这张图片的内容"})
    messages = [{"role": "user", "content": content_blocks}]

    # Method 1: Use GA's LLM client raw_ask (preferred - handles proxy/auth correctly)
    # Skip NativeClaudeSession as it requires tools and uses Claude Code protocol
    _skip_raw_ask = False
    if llm_client:
        _client_type = type(llm_client).__name__
        if "NativeClaude" in _client_type:
            _skip_raw_ask = True
    if llm_client and hasattr(llm_client, 'raw_ask') and not _skip_raw_ask:
        try:
            with open(_vlog, "a", encoding="utf-8") as _f:
                _f.write(f"[{_time.strftime('%H:%M:%S')}] vision: using llm_client.raw_ask()\n")
            gen = llm_client.raw_ask(messages)
            # raw_ask returns a generator - consume it to get the full response
            import types
            if isinstance(gen, types.GeneratorType):
                description = ""
                for chunk in gen:
                    if isinstance(chunk, str):
                        description += chunk
                if not description:
                    raise ValueError("empty response from raw_ask generator")
            else:
                description = gen if isinstance(gen, str) else str(gen)
            if description:
                if user_text:
                    return f"[用户发送了图片，以下是图片内容描述]\n{description}\n\n[用户附言] {user_text}"
                else:
                    return f"[用户发送了图片，以下是图片内容描述]\n{description}\n\n请根据图片内容回复用户。"
        except Exception as e:
            with open(_vlog, "a", encoding="utf-8") as _f:
                _f.write(f"[{_time.strftime('%H:%M:%S')}] vision: raw_ask failed: {e}, falling back to urllib\n")

    # Method 2: Fallback - use requests library with proxy from config
    try:
        import requests as _requests
    except ImportError:
        _requests = None

    # Get config from llm_client or mykey.py
    apikey = ""
    apibase = ""
    model = ""
    proxy = None
    if llm_client:
        apikey = getattr(llm_client, "api_key", "") or getattr(llm_client, "apikey", "")
        apibase = getattr(llm_client, "base_url", "") or getattr(llm_client, "apibase", "")
        model = getattr(llm_client, "model_name", "") or getattr(llm_client, "model", "")
        proxy = getattr(llm_client, "proxy", None)
        proxies_dict = getattr(llm_client, "proxies", None)
        if proxies_dict and isinstance(proxies_dict, dict):
            proxy = proxies_dict.get("https") or proxies_dict.get("http")
        if isinstance(apibase, object) and not isinstance(apibase, str):
            apibase = str(apibase)

    if not apikey or not apibase:
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
        _cfg_names = ["native_oai_config_opus47", "native_oai_config_opus46",
                      "native_oai_config_opus46_thinking", "native_oai_config_dsv4pro",
                      "native_claude_config_opus47", "native_claude_config_opus46"]
        cfg = None
        for _name in _cfg_names:
            cfg = getattr(mykey, _name, None)
            if cfg: break
        if not cfg:
            for attr in dir(mykey):
                val = getattr(mykey, attr, None)
                if isinstance(val, dict) and val.get("apikey") and val.get("apibase"):
                    cfg = val
                    break
        if not cfg:
            return f"[图片预处理失败: mykey.py中未找到可用的LLM配置]\n\n{user_text}"
        apikey = cfg.get("apikey", "")
        apibase = cfg.get("apibase", "").rstrip("/")
        model = cfg.get("model", "claude-sonnet-4-20250514")
        proxy = cfg.get("proxy")

    apibase = apibase.rstrip("/")
    if not model:
        model = "claude-sonnet-4-20250514"
    is_claude_native = "api.anthropic.com" in apibase or "claude" in model.lower()

    import re as _re
    def _make_url(base, path):
        b, p = base.rstrip('/'), path.strip('/')
        if b.endswith(p): return b
        return f"{b}/{p}" if _re.search(r'/v\d+(/|$)', b) else f"{b}/v1/{p}"

    with open(_vlog, "a", encoding="utf-8") as _f:
        _f.write(f"[{_time.strftime('%H:%M:%S')}] vision fallback: apibase={apibase}, model={model}, proxy={proxy}, is_native={is_claude_native}\n")

    if is_claude_native:
        url = _make_url(apibase, "messages")
        headers = {"Content-Type": "application/json", "x-api-key": apikey,
                   "anthropic-version": "2023-06-01", "Accept": "text/event-stream"}
        payload = {"model": model, "max_tokens": 2048, "messages": messages, "stream": True}
    else:
        url = _make_url(apibase, "chat/completions")
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {apikey}",
                   "Accept": "text/event-stream"}
        # Convert to OpenAI image format (use already-compressed images)
        oai_content = []
        for img_b64 in images_b64:
            compressed = _compress_image(img_b64)
            oai_content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{compressed}"}})
        oai_content.append({"type": "text", "text": user_text or "请详细描述这张图片的内容"})
        payload = {"model": model, "max_tokens": 2048, "stream": True,
                   "messages": [{"role": "user", "content": oai_content}]}

    proxies = {"http": proxy, "https": proxy} if proxy else None

    try:
        if _requests:
            r = _requests.post(url, headers=headers, json=payload, timeout=120, proxies=proxies, stream=True, verify=False)
            r.raise_for_status()
            # Parse SSE stream to collect full response
            description = ""
            for line in r.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data: "):
                    continue
                data_str = line[6:]
                if data_str.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                    if is_claude_native:
                        # Claude streaming: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
                        if chunk.get("type") == "content_block_delta":
                            delta = chunk.get("delta", {})
                            description += delta.get("text", "")
                    else:
                        # OpenAI streaming: {"choices":[{"delta":{"content":"..."}}]}
                        choices = chunk.get("choices", [])
                        if choices:
                            delta = choices[0].get("delta", {})
                            description += delta.get("content", "") or ""
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
            r.close()
        else:
            # urllib fallback (non-streaming, may not work with all proxies)
            payload["stream"] = False
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=data, method="POST")
            for k, v in headers.items():
                req.add_header(k, v)
            with urllib.request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            if is_claude_native:
                description = result["content"][0]["text"]
            else:
                description = result["choices"][0]["message"]["content"]

        if not description:
            return f"[图片预处理失败: 未获取到图片描述]\n\n{user_text}"

        if user_text:
            return f"[用户发送了图片，以下是图片内容描述]\n{description}\n\n[用户附言] {user_text}"
        else:
            return f"[用户发送了图片，以下是图片内容描述]\n{description}\n\n请根据图片内容回复用户。"
    except Exception as e:
        err_msg = str(e)
        if hasattr(e, 'response') and e.response is not None:
            err_msg = f"HTTP {e.response.status_code} - {e.response.text[:200]}"
        with open(_vlog, "a", encoding="utf-8") as _f:
            _f.write(f"[{_time.strftime('%H:%M:%S')}] vision ERROR: {err_msg}\n")
        return f"[图片预处理失败: {err_msg}]\n\n{user_text}"


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

        send({"event": "log", "msg": "Creating GenericAgent instance..."})
        try:
            agent = agentmain.GenericAgent()
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

        # Install cost tracker (must be before agent.run() to hook llmcore)
        try:
            from frontends.cost_tracker import install as _install_cost_tracker
            _install_cost_tracker()
            send({"event": "log", "msg": "cost_tracker installed"})
        except Exception as e:
            send({"event": "log", "msg": f"cost_tracker not available: {e}"})

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
        if getattr(agent, 'dev_mode', False):
            parts.append(
                "\n[DEV MODE] 开发实践约束：\n"
                "1. 单次回复不超过一个功能模块，分步交付\n"
                "2. 先设计接口/结构，确认后再实现\n"
                "3. 模块职责单一，文件不超过200行\n"
                "4. 遵循：关注点分离、DRY、SOLID\n"
                "5. 代码前先说方案，等确认"
            )
        if getattr(agent, 'autonomous', False):
            parts.append(
                "\n### 行动规范（持续有效）\n"
                "每次回复（含工具调用轮）都先在回复文字中包含一个<summary></summary> 中输出极简单行（<30字）物理快照：上次结果新信息+本次意图。此内容进入长期工作记忆。\n\n"
                "**若用户需求未完成，必须进行工具调用！**"
            )
        if getattr(agent, 'goal', ''):
            parts.append(f"\n[当前目标] {agent.goal}")
        if getattr(agent, 'reflect', False):
            reflect_interval = getattr(agent, 'reflect_interval', 5)
            parts.append(
                f"\n[反思模式] 每次行动后自我检查：结果是否符合预期？是否需要修正方向？\n"
                f"每 {reflect_interval} 轮对话后，进行一次完整复盘：\n"
                f"1. 回顾目标完成进度\n2. 总结已完成的步骤和成果\n3. 识别遇到的问题和偏差\n4. 调整后续策略和优先级"
            )
            if total_turns > 0 and total_turns % reflect_interval == 0:
                parts.append(
                    f"\n⚠️ [复盘触发: 已完成 {total_turns} 轮] 请先进行复盘总结再继续执行任务。"
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
            if images:
                _dbg(f"Processing {len(images)} images...")
                send({"event": "log", "msg": f"正在处理 {len(images)} 张图片..."})
                try:
                    cur_client = None
                    try:
                        llm_no = getattr(agent, "llm_no", 0)
                        if hasattr(agent, "llmclients") and len(agent.llmclients) > llm_no:
                            cur_client = agent.llmclients[llm_no]
                    except Exception:
                        pass
                    query = vision_preprocess(images, text, ga_root=agent_dir, llm_client=cur_client)
                except Exception as e:
                    _dbg(f"Vision preprocess failed: {e}")
                    # Fallback: save images as temp files and reference them
                    import tempfile
                    img_paths = []
                    for i, img_b64 in enumerate(images):
                        try:
                            raw = img_b64.split(",", 1)[1] if "," in img_b64 else img_b64
                            img_data = base64.b64decode(raw)
                            tmp = tempfile.NamedTemporaryFile(suffix=".png", dir=os.path.join(agent_dir, "temp"), delete=False, prefix=f"img_{i}_")
                            tmp.write(img_data)
                            tmp.close()
                            img_paths.append(tmp.name)
                        except Exception:
                            pass
                    if img_paths:
                        paths_str = "\n".join(f"  - {p}" for p in img_paths)
                        query = f"[用户发送了{len(images)}张图片，已保存到以下路径，请用vision工具查看]\n{paths_str}\n\n{text}" if text else f"[用户发送了{len(images)}张图片，已保存到以下路径，请用vision工具查看]\n{paths_str}"
                    else:
                        query = f"[图片处理失败: {e}]\n\n{text}" if text else f"[图片处理失败: {e}]"
            else:
                query = text
            # Handle slash commands locally
            if query.startswith('/'):
                cmd_handled = False
                if query.strip() == '/clear':
                    if hasattr(agent, 'llmclient') and hasattr(agent.llmclient, 'backend'):
                        agent.llmclient.backend.history = []
                    if hasattr(agent, 'history'):
                        agent.history = []
                    if hasattr(agent, 'handler') and agent.handler:
                        agent.handler.working = {}
                    send({"event": "done", "text": "Context cleared.", "tokens": 0})
                    cmd_handled = True
                elif query.strip() == '/status':
                    info = f"Status: {'busy' if is_busy else 'idle'}\nTurns: {total_turns}\nTokens: {tokens_used}"
                    send({"event": "done", "text": info, "tokens": 0})
                    cmd_handled = True
                elif query.strip() == '/stop':
                    if is_busy:
                        agent.abort()
                        send({"event": "aborted"})
                    else:
                        send({"event": "done", "text": "No task running.", "tokens": 0})
                    cmd_handled = True
                if cmd_handled:
                    continue
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

        elif c == "clear":
            # Reset GA's LLM context for a fresh conversation
            if hasattr(agent, 'llmclient') and hasattr(agent.llmclient, 'backend'):
                agent.llmclient.backend.history = []
            if hasattr(agent, 'history'):
                agent.history = []
            if hasattr(agent, 'handler') and agent.handler:
                agent.handler.working = {}
            send({"event": "done", "text": "Context cleared.", "tokens": 0})

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
            allowed = {"autonomous", "goal", "peer_hint", "reflect", "reflect_interval", "verbose", "scheduler", "dev_mode", "team_worker", "team_base_url", "team_board_key", "team_name"}
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

        elif c == "get_costs":
            try:
                from frontends.cost_tracker import all_trackers
                trackers = all_trackers()
                result = {"requests": 0, "input": 0, "output": 0,
                          "cache_create": 0, "cache_read": 0, "last_input": 0, "started_at": 0}
                for _name, ts in trackers.items():
                    result["requests"] += ts.requests
                    result["input"] += ts.input
                    result["output"] += ts.output
                    result["cache_create"] += ts.cache_create
                    result["cache_read"] += ts.cache_read
                    result["last_input"] = max(result["last_input"], ts.last_input)
                    if ts.started_at and (result["started_at"] == 0 or ts.started_at < result["started_at"]):
                        result["started_at"] = ts.started_at
                total_input_side = result["input"] + result["cache_create"] + result["cache_read"]
                result["cache_hit_rate"] = round(result["cache_read"] / total_input_side * 100, 1) if total_input_side else 0
                result["total_tokens"] = result["input"] + result["output"] + result["cache_create"] + result["cache_read"]
                result["elapsed_seconds"] = int(time.time() - result["started_at"]) if result["started_at"] else 0
                send({"event": "costs", **result})
            except Exception as e:
                send({"event": "costs", "error": str(e), "requests": 0, "input": 0, "output": 0,
                      "cache_create": 0, "cache_read": 0, "cache_hit_rate": 0, "total_tokens": 0, "elapsed_seconds": 0})

        else:
            send({"event": "error", "msg": f"Unknown cmd: {c}"})


if __name__ == "__main__":
    main()

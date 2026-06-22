# checklist_helper.py — CL(folder) 一站式任务清单（支持 checklist/mapreduce 两种模式）
import json, time, subprocess, socket, sys
from pathlib import Path
_R = Path(__file__).resolve().parent.parent
_BBS, _MAIN = _R/"assets/agent_bbs.py", _R/"agentmain.py"
_W_RE, _M_RE = _R/"reflect/agent_team_worker.py", _R/"reflect/checklist_master.py"
_PK = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
if sys.platform == "win32": _PK["creationflags"] = 0x200

class CL:
    def __init__(self, folder, goal="", workers=0):
        """
        workers=0: checklist模式，master自己逐个执行，不启动BBS
        workers>0: mapreduce模式，启动BBS+N个worker并行
        """
        self.folder = Path(folder); self.folder.mkdir(parents=True, exist_ok=True)
        self.path = self.folder / "state.json"
        self.workers = workers
        if self.path.exists(): self._d = json.loads(self.path.read_text("utf-8"))
        else:
            self._d = {"closed": False, "goal": goal, "bbs": None, "tasks": []}
            self._save()
            if workers > 0:
                self._ensure_bbs()
                self.start_worker(workers)

    @property
    def tasks(self): return self._d["tasks"]
    @property
    def closed(self): return self._d.get("closed", False)
    @property
    def has_open(self): return any(t["result"] is None for t in self.tasks)
    @property
    def bbs_url(self): return self._d["bbs"]["url"] if self._d["bbs"] else None
    @property
    def bbs_key(self): return self._d["bbs"]["key"] if self._d["bbs"] else None
    @property
    def mode(self): return "mapreduce" if self._d["bbs"] else "checklist"
    def _save(self): self.path.write_text(json.dumps(self._d, ensure_ascii=False, indent=1), "utf-8")

    @staticmethod
    def _get_excluded_port_ranges():
        """Parse Windows excluded port ranges (Hyper-V/WSL2 dynamic reservations)."""
        if sys.platform != "win32":
            return []
        try:
            r = subprocess.run(["netsh", "interface", "ipv4", "show", "excludedportrange", "protocol=tcp"],
                               capture_output=True, text=True, timeout=5)
            ranges = []
            for line in r.stdout.splitlines():
                parts = line.split()
                if len(parts) >= 2:
                    try:
                        ranges.append((int(parts[0]), int(parts[1])))
                    except ValueError:
                        pass
            return ranges
        except Exception:
            return []

    @staticmethod
    def _port_in_excluded(port, excluded_ranges):
        return any(lo <= port <= hi for lo, hi in excluded_ranges)

    def _ensure_bbs(self):
        if self._d["bbs"]: return
        key = f"cl_{int(time.time())%1000}"
        (self.folder/"bbs").mkdir(exist_ok=True)
        excluded = self._get_excluded_port_ranges()
        # Retry port selection, skipping Windows excluded port ranges
        for _ in range(20):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                try:
                    s.bind(('0.0.0.0', 0))
                    port = s.getsockname()[1]
                except OSError:
                    continue
            # Skip ports in Windows excluded ranges
            if self._port_in_excluded(port, excluded):
                continue
            # Double-check: re-bind to confirm port is truly available
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s2:
                    s2.bind(('0.0.0.0', port))
            except OSError:
                continue
            subprocess.Popen([sys.executable, str(_BBS), "--cwd", str(self.folder/"bbs"),
                              "--port", str(port), "--key", key], **_PK)
            time.sleep(1)
            self._d["bbs"] = {"url": f"http://127.0.0.1:{port}", "key": key}
            self._save()
            return
        raise RuntimeError("BBS failed to start: no available port after 20 attempts")

    def add(self, texts):
        nid = max((t["id"] for t in self.tasks), default=0) + 1
        ids = []
        for t in texts:
            self.tasks.append({"id": nid, "text": t, "result": None, "ts": int(time.time())})
            ids.append(nid); nid += 1
        self._save(); 
        print('task added, must reread checklist SOP before start executing ...');
        return ids

    def mark(self, tid, result):
        for t in self.tasks:
            if t["id"] == tid: t["result"] = result; t["ts"] = int(time.time()); break
        self._save()

    def look(self):
        done = sum(1 for t in self.tasks if t["result"] is not None)
        lines = [f"[{done}/{len(self.tasks)}] mode={self.mode}"]
        for t in self.tasks:
            l = f'{"✓" if t["result"] else "○"} #{t["id"]} {t["text"][:60]}'
            if t["result"]: l += f'  → {t["result"][:60]}'
            lines.append(l)
        return "\n".join(lines)

    def close(self):
        assert not self.has_open, "has open tasks"
        self._d["closed"] = True; self._save()

    def start_worker(self, n=None):
        n = n or self.workers or 1
        if n <= 0: return
        for i in range(n):
            subprocess.Popen(["python", str(_MAIN), "--reflect", str(_W_RE),
                "--base_url", self.bbs_url, "--board_key", self.bbs_key, "--name", f"w{i+1}"], **_PK)
            if i < n - 1: time.sleep(5)

    def _pid_alive(self, pid):
        if not pid: return False
        try:
            r = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True)
            return str(pid) in r.stdout
        except Exception: return False

    def start_master(self):
        old_pid = self._d.get("master_pid")
        if old_pid and self._pid_alive(old_pid):
            print(f"[CL] master already running (PID {old_pid}), skip")
            return
        p = subprocess.Popen(["python", str(_MAIN), "--reflect", str(_M_RE),
            "--mr_folder", str(self.folder.resolve())], **_PK)
        self._d["master_pid"] = p.pid; self._save()

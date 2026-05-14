"""
Instance Isolation Module for GA Manager
=========================================
Provides two mechanisms to prevent resource conflicts when running multiple GA instances:

1. Temp Directory Isolation: Each instance gets its own temp subdirectory (temp/instance_{name}/)
   so code_run outputs don't collide.

2. Memory File Locking: Writes to the shared memory/ directory are serialized using
   cross-process file locks (via filelock) to prevent corruption.

Usage: Call `apply_isolation(instance_name)` AFTER `import agentmain` but BEFORE `agent.run()`.
This monkey-patches GenericAgentHandler without modifying GA source code.
"""

import os
import functools
from filelock import FileLock

# Global lock directory - created once
_LOCK_DIR = None
_INSTANCE_NAME = None


def _get_lock_dir(agent_dir: str) -> str:
    """Get/create the directory for lock files."""
    lock_dir = os.path.join(agent_dir, "temp", ".locks")
    os.makedirs(lock_dir, exist_ok=True)
    return lock_dir


def _get_lock_for_path(filepath: str) -> FileLock:
    """Get a FileLock for a given file path. Uses filename-based lock to serialize writes."""
    # Normalize and create a safe lock filename from the target path
    # For memory files, lock by filename to allow parallel writes to different files
    basename = os.path.basename(filepath).replace(" ", "_")
    lock_file = os.path.join(_LOCK_DIR, f"mem_{basename}.lock")
    return FileLock(lock_file, timeout=30)


def _is_memory_path(filepath: str, agent_dir: str) -> bool:
    """Check if a file path is under the memory/ directory."""
    try:
        abs_path = os.path.abspath(filepath)
        memory_dir = os.path.abspath(os.path.join(agent_dir, "memory"))
        return abs_path.startswith(memory_dir + os.sep) or abs_path == memory_dir
    except (ValueError, TypeError):
        return False


def _wrap_file_write(original_method, agent_dir):
    """Wrap do_file_write to add file locking for memory/ paths."""
    @functools.wraps(original_method)
    def wrapped(self, args, response):
        path = self._get_abs_path(args.get("path", ""))
        if _is_memory_path(path, agent_dir):
            lock = _get_lock_for_path(path)
            with lock:
                return original_method(self, args, response)
        else:
            return original_method(self, args, response)
    return wrapped


def _wrap_file_patch(original_method, agent_dir):
    """Wrap do_file_patch to add file locking for memory/ paths."""
    @functools.wraps(original_method)
    def wrapped(self, args, response):
        path = self._get_abs_path(args.get("path", ""))
        if _is_memory_path(path, agent_dir):
            lock = _get_lock_for_path(path)
            with lock:
                return original_method(self, args, response)
        else:
            return original_method(self, args, response)
    return wrapped


def _wrap_init(original_init, instance_temp_dir):
    """Wrap GenericAgentHandler.__init__ to redirect temp_dir to instance-specific directory."""
    @functools.wraps(original_init)
    def wrapped(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        # Override temp_dir to instance-specific path
        self.temp_dir = instance_temp_dir
        os.makedirs(instance_temp_dir, exist_ok=True)
    return wrapped


def apply_isolation(instance_name: str, agent_dir: str, send_fn=None):
    """
    Apply instance isolation by monkey-patching GenericAgentHandler.
    
    Must be called AFTER `import agentmain` (so `ga` module is loaded)
    but BEFORE `agent.run()` (so the patches take effect on handler creation).
    
    Args:
        instance_name: Unique instance identifier (used for temp subdirectory)
        agent_dir: Path to GenericAgent root directory
        send_fn: Optional logging function (bridge's send())
    """
    global _LOCK_DIR, _INSTANCE_NAME
    
    import ga  # Already imported by agentmain at this point
    
    _INSTANCE_NAME = instance_name or "default"
    # Sanitize instance name for filesystem use
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in _INSTANCE_NAME)
    
    # 1. Setup instance-specific temp directory
    instance_temp_dir = os.path.join(agent_dir, "temp", f"instance_{safe_name}")
    os.makedirs(instance_temp_dir, exist_ok=True)
    
    # 2. Setup lock directory
    _LOCK_DIR = _get_lock_dir(agent_dir)
    
    # 3. Monkey-patch GenericAgentHandler
    handler_cls = ga.GenericAgentHandler
    
    # Patch __init__ to use instance-specific temp dir
    handler_cls.__init__ = _wrap_init(handler_cls.__init__, instance_temp_dir)
    
    # Patch file write/patch to add locking for memory/ paths
    if hasattr(handler_cls, 'do_file_write'):
        handler_cls.do_file_write = _wrap_file_write(handler_cls.do_file_write, agent_dir)
    
    if hasattr(handler_cls, 'do_file_patch'):
        handler_cls.do_file_patch = _wrap_file_patch(handler_cls.do_file_patch, agent_dir)
    
    if send_fn:
        send_fn({"event": "log", "msg": f"[Isolation] temp={instance_temp_dir}, memory locks enabled"})
    
    return instance_temp_dir

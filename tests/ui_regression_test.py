"""
GA Manager UI Regression Test Script
=====================================
自动构建→启动→窗口截图→与基线图对比→报告差异

用法:
    python tests/ui_regression_test.py [--update-baseline] [--skip-build]

流程:
    1. 编译前端+后端+桌面端 (可跳过)
    2. 启动后端 → 等待端口就绪
    3. 截取Web UI窗口截图
    4. 与基线图对比 (SSIM + 像素差异)
    5. 生成报告

依赖: pip install Pillow requests
可选: pip install scikit-image (用于SSIM对比)
"""

import subprocess
import sys
import os
import time
import json
import argparse
import signal
from pathlib import Path
from datetime import datetime

# Project paths
PROJECT_ROOT = Path(__file__).parent.parent
BUILD_DIR = PROJECT_ROOT / "build"
FRONTEND_DIR = PROJECT_ROOT / "frontend"
BACKEND_DIR = PROJECT_ROOT / "backend"
DESKTOP_DIR = PROJECT_ROOT / "desktop"
BASELINE_DIR = Path(__file__).parent / "baselines"
REPORT_DIR = Path(__file__).parent / "reports"

BACKEND_PORT = 18600
BACKEND_URL = f"http://localhost:{BACKEND_PORT}"


def log(msg, level="INFO"):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}")


def run_cmd(cmd, cwd=None, timeout=120):
    """Run a command and return (success, stdout, stderr)"""
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True,
            cwd=cwd, timeout=timeout, shell=isinstance(cmd, str)
        )
        return r.returncode == 0, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return False, "", "TIMEOUT"
    except Exception as e:
        return False, "", str(e)


def build_frontend():
    """Build frontend with vite"""
    log("Building frontend...")
    out_dir = str(BUILD_DIR / "static")
    ok, stdout, stderr = run_cmd(
        ["npx", "vite", "build", "--outDir", out_dir],
        cwd=str(FRONTEND_DIR), timeout=60
    )
    if not ok:
        log(f"Frontend build FAILED: {stderr[:200]}", "ERROR")
        return False
    log("Frontend build OK")
    return True


def build_backend():
    """Build Go backend"""
    log("Building backend...")
    ok, stdout, stderr = run_cmd(
        ["go", "build", "-ldflags=-s -w", "-o",
         str(BUILD_DIR / "ga-manager-backend.exe"), "."],
        cwd=str(BACKEND_DIR), timeout=120
    )
    if not ok:
        log(f"Backend build FAILED: {stderr[:200]}", "ERROR")
        return False
    log("Backend build OK")
    return True


def build_desktop():
    """Build Go desktop wrapper"""
    log("Building desktop...")
    ok, stdout, stderr = run_cmd(
        ["go", "build", "-ldflags=-s -w", "-o",
         str(BUILD_DIR / "ga-manager.exe"), "."],
        cwd=str(DESKTOP_DIR), timeout=120
    )
    if not ok:
        log(f"Desktop build FAILED: {stderr[:200]}", "ERROR")
        return False
    log("Desktop build OK")
    return True


def wait_for_port(port, timeout=15):
    """Wait until port is listening"""
    import socket
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except (ConnectionRefusedError, OSError):
            time.sleep(0.5)
    return False


def start_backend():
    """Start backend process, return Popen"""
    exe = BUILD_DIR / "ga-manager-backend.exe"
    if not exe.exists():
        log("Backend exe not found!", "ERROR")
        return None
    log("Starting backend...")
    proc = subprocess.Popen(
        [str(exe)],
        cwd=str(BUILD_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
    )
    if wait_for_port(BACKEND_PORT):
        log(f"Backend ready on port {BACKEND_PORT}")
        return proc
    else:
        log("Backend failed to start (port not ready)", "ERROR")
        proc.kill()
        return None


def capture_screenshot_web(url, save_path):
    """Capture web UI screenshot using win32gui + PIL"""
    try:
        import requests
        r = requests.get(url, timeout=5)
        if r.status_code != 200:
            log(f"Web UI returned {r.status_code}", "ERROR")
            return False
    except Exception as e:
        log(f"Cannot reach web UI: {e}", "ERROR")
        return False

    try:
        from PIL import Image, ImageGrab
        import win32gui

        # Open URL in browser
        os.startfile(url)
        time.sleep(3)

        def find_window_by_title(partial_title):
            results = []
            def callback(hwnd, _):
                if win32gui.IsWindowVisible(hwnd):
                    title = win32gui.GetWindowText(hwnd)
                    if partial_title.lower() in title.lower():
                        results.append(hwnd)
            win32gui.EnumWindows(callback, None)
            return results[0] if results else None

        hwnd = find_window_by_title("GA Manager") or find_window_by_title("localhost")
        if not hwnd:
            time.sleep(1)
            hwnd = win32gui.GetForegroundWindow()

        if hwnd:
            win32gui.SetForegroundWindow(hwnd)
            time.sleep(0.5)
            rect = win32gui.GetWindowRect(hwnd)
            img = ImageGrab.grab(bbox=rect)
            img.save(str(save_path))
            log(f"Screenshot saved: {save_path} ({img.size[0]}x{img.size[1]})")
            return True
        else:
            log("No window found for screenshot", "ERROR")
            return False

    except ImportError as e:
        log(f"Screenshot deps missing: {e}. Using fallback.", "WARN")
        import hashlib, requests
        r = requests.get(url, timeout=5)
        html_hash = hashlib.md5(r.content).hexdigest()
        save_path.with_suffix('.txt').write_text(
            f"HTML hash: {html_hash}\nStatus: {r.status_code}\nLength: {len(r.content)}\n"
        )
        log(f"Fallback: saved HTML hash to {save_path.with_suffix('.txt')}")
        return True


def compare_images(current_path, baseline_path):
    """Compare two images, return (similarity_score, diff_path)"""
    try:
        from PIL import Image, ImageChops, ImageStat
    except ImportError:
        log("PIL not available for comparison", "WARN")
        return None, None

    if not baseline_path.exists():
        log("No baseline image found. Use --update-baseline to create one.")
        return None, None

    img_current = Image.open(current_path).convert("RGB")
    img_baseline = Image.open(baseline_path).convert("RGB")

    if img_current.size != img_baseline.size:
        log(f"Size mismatch: current={img_current.size} baseline={img_baseline.size}", "WARN")
        img_baseline = img_baseline.resize(img_current.size, Image.LANCZOS)

    diff = ImageChops.difference(img_current, img_baseline)
    stat = ImageStat.Stat(diff)
    mean_diff = sum(stat.mean) / 3.0
    similarity = 1.0 - (mean_diff / 255.0)

    diff_path = current_path.with_name(current_path.stem + "_diff.png")
    diff_amplified = diff.point(lambda x: min(x * 5, 255))
    diff_amplified.save(str(diff_path))

    log(f"Similarity: {similarity:.4f} (mean_diff={mean_diff:.2f}/255)")
    return similarity, diff_path


def check_api_health():
    """Quick API health checks"""
    import requests
    results = {}
    endpoints = [
        ("GET", "/api/instances", None),
        ("GET", "/api/system/resources", None),
        ("GET", "/api/sops", None),
    ]
    for method, path, body in endpoints:
        try:
            url = f"{BACKEND_URL}{path}"
            if method == "GET":
                r = requests.get(url, timeout=5)
            else:
                r = requests.post(url, json=body, timeout=5)
            results[path] = {"status": r.status_code, "ok": r.status_code == 200}
        except Exception as e:
            results[path] = {"status": 0, "ok": False, "error": str(e)}
    return results


def generate_report(build_ok, screenshot_ok, similarity, api_results, report_path):
    """Generate markdown report"""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        f"# UI Regression Test Report",
        f"**Date**: {ts}",
        f"",
        f"## Build Status",
        f"- Frontend: {'PASS' if build_ok.get('frontend', False) else 'FAIL'}",
        f"- Backend: {'PASS' if build_ok.get('backend', False) else 'FAIL'}",
        f"- Desktop: {'PASS' if build_ok.get('desktop', False) else 'FAIL'}",
        f"",
        f"## Screenshot Comparison",
    ]
    if similarity is not None:
        threshold = 0.95
        status = "PASS" if similarity >= threshold else "FAIL"
        lines.append(f"- Similarity: {similarity:.4f} (threshold: {threshold})")
        lines.append(f"- Result: {status}")
    elif screenshot_ok:
        lines.append("- Screenshot captured (no baseline for comparison)")
    else:
        lines.append("- Screenshot capture failed")

    lines.extend([f"", f"## API Health"])
    for path, result in (api_results or {}).items():
        status = "OK" if result.get("ok") else "FAIL"
        lines.append(f"- {path}: {status} (HTTP {result.get('status', '?')})")

    lines.extend([f"", f"## Artifacts"])
    be = BUILD_DIR / "ga-manager-backend.exe"
    de = BUILD_DIR / "ga-manager.exe"
    lines.append(f"- Backend: {be} ({os.path.getsize(be) // 1024 // 1024}MB)" if be.exists() else "- Backend: MISSING")
    lines.append(f"- Desktop: {de} ({os.path.getsize(de) // 1024 // 1024}MB)" if de.exists() else "- Desktop: MISSING")
    sa = BUILD_DIR / "static" / "assets"
    lines.append(f"- Static assets: {len(list(sa.glob('*')))} files" if sa.exists() else "- Static: MISSING")

    report_path.write_text("\n".join(lines), encoding="utf-8")
    log(f"Report saved: {report_path}")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="GA Manager UI Regression Test")
    parser.add_argument("--update-baseline", action="store_true", help="Save current screenshot as new baseline")
    parser.add_argument("--skip-build", action="store_true", help="Skip build step")
    parser.add_argument("--skip-screenshot", action="store_true", help="Skip screenshot (API-only test)")
    args = parser.parse_args()

    BASELINE_DIR.mkdir(exist_ok=True)
    REPORT_DIR.mkdir(exist_ok=True)

    build_results = {}
    backend_proc = None

    try:
        # Step 1: Build
        if not args.skip_build:
            build_results["frontend"] = build_frontend()
            build_results["backend"] = build_backend()
            build_results["desktop"] = build_desktop()
            if not all(build_results.values()):
                log("Build failed! Aborting.", "ERROR")
                return 1
        else:
            log("Skipping build (--skip-build)")
            build_results = {"frontend": True, "backend": True, "desktop": True}

        # Step 2: Start backend
        backend_proc = start_backend()
        if not backend_proc:
            return 1

        # Step 3: API health check
        api_results = check_api_health()
        log(f"API health: {sum(1 for v in api_results.values() if v['ok'])}/{len(api_results)} OK")

        # Step 4: Screenshot
        screenshot_ok = False
        similarity = None
        if not args.skip_screenshot:
            screenshot_path = REPORT_DIR / f"screenshot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
            screenshot_ok = capture_screenshot_web(BACKEND_URL, screenshot_path)

            if screenshot_ok and args.update_baseline:
                import shutil
                baseline_path = BASELINE_DIR / "baseline_main.png"
                shutil.copy2(screenshot_path, baseline_path)
                log(f"Baseline updated: {baseline_path}")
            elif screenshot_ok:
                baseline_path = BASELINE_DIR / "baseline_main.png"
                similarity, diff_path = compare_images(screenshot_path, baseline_path)
        else:
            log("Skipping screenshot (--skip-screenshot)")

        # Step 5: Generate report
        report_path = REPORT_DIR / f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        report = generate_report(build_results, screenshot_ok, similarity, api_results, report_path)
        print("\n" + "=" * 50)
        print(report)
        print("=" * 50)

        all_api_ok = all(v.get("ok") for v in api_results.values())
        if similarity is not None:
            passed = similarity >= 0.95 and all_api_ok
        else:
            passed = all_api_ok

        return 0 if passed else 1

    finally:
        if backend_proc:
            log("Stopping backend...")
            backend_proc.terminate()
            try:
                backend_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                backend_proc.kill()
            log("Backend stopped")


if __name__ == "__main__":
    sys.exit(main())

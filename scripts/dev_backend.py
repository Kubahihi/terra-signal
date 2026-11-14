"""Reload the Windows backend without broadcasting console interrupts."""

import os
from pathlib import Path
import subprocess
import sys
import threading
import time

WATCH_DIRECTORY = Path(__file__).resolve().parents[1] / "backend" / "app"


def snapshot() -> dict[str, int]:
    result = {}
    for path in WATCH_DIRECTORY.rglob("*.py"):
        try:
            result[str(path)] = path.stat().st_mtime_ns
        except OSError:
            pass  # An editor may be replacing a file atomically.
    return result


def stop_backend(backend: subprocess.Popen) -> None:
    if backend.poll() is None:
        subprocess.run(
            [str(Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "taskkill.exe"),
             "/PID", str(backend.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        backend.wait()


def start_backend() -> tuple[subprocess.Popen, threading.Thread]:
    backend = subprocess.Popen(
        [sys.executable, *sys.argv[1:]], creationflags=subprocess.CREATE_NO_WINDOW,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        encoding="utf-8", errors="replace",
        env={**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"},
    )

    def forward_logs() -> None:
        assert backend.stdout is not None
        with backend.stdout:
            for line in backend.stdout:
                print(line, end="", flush=True)

    log_thread = threading.Thread(target=forward_logs, daemon=True)
    log_thread.start()
    return backend, log_thread


def main() -> int:
    known = snapshot()
    backend, log_thread = start_backend()
    reported_exit = False
    try:
        while True:
            time.sleep(0.5)
            current = snapshot()
            if current != known:
                known = current
                print("Backend application changed. Restarting the API...", flush=True)
                stop_backend(backend)
                log_thread.join(timeout=2)
                backend, log_thread = start_backend()
                reported_exit = False
            elif backend.poll() is not None and not reported_exit:
                print(f"Backend exited ({backend.returncode}). Fix the application source to restart it.", flush=True)
                reported_exit = True
    except KeyboardInterrupt:
        return 130
    finally:
        stop_backend(backend)
        log_thread.join(timeout=2)


if __name__ == "__main__":
    raise SystemExit(main())

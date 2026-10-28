"""PyInstaller 入口：原生窗口。"""
import os
import sys
import threading
import traceback


def _prepare_frozen_streams() -> None:
    """窗口模式下 sys.stdout/stderr 为 None，部分库会因此抛异常：重定向到日志文件。"""
    if not getattr(sys, "frozen", False):
        return
    base = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"),
                        "ActivityPhotoCull", "logs")
    os.makedirs(base, exist_ok=True)
    handle = open(os.path.join(base, "crash.log"), "a", encoding="utf-8", buffering=1)
    sys.stdout = handle
    sys.stderr = handle

    def excepthook(exc_type, exc, tb):
        traceback.print_exception(exc_type, exc, tb)
        handle.flush()

    def thread_hook(args):
        traceback.print_exception(args.exc_type, args.exc_value, args.exc_traceback)
        handle.flush()

    sys.excepthook = excepthook
    threading.excepthook = thread_hook


if __name__ == "__main__":
    _prepare_frozen_streams()
    from app.desktop import main

    sys.exit(main())

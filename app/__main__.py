"""启动本地服务并打开浏览器。"""
from __future__ import annotations

import argparse
import logging
import os
import socket
import threading
import webbrowser

from . import config, db

LOG_FORMAT = "%(asctime)s %(levelname)s %(message)s"


def _free_port() -> int:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]
    finally:
        sock.close()


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format=LOG_FORMAT,
        handlers=[logging.FileHandler(os.path.join(config.logs_dir(), "app.log"), encoding="utf-8")],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=config.APP_DISPLAY_NAME)
    parser.add_argument("--port", type=int, default=0, help="固定端口（默认随机空闲端口）")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args()

    _setup_logging()
    db.init_db()

    import uvicorn
    from .api import app

    port = args.port or _free_port()
    url = f"http://127.0.0.1:{port}/"
    print(f"{config.APP_DISPLAY_NAME} v{config.VERSION}")
    print(f"界面地址：{url}")
    print("使用期间请保留本窗口；关闭本窗口即退出程序。")

    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()

    try:
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

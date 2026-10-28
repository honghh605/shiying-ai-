"""原生窗口启动器：本地服务 + pywebview 窗口；失败时回退到 Edge 应用窗口/默认浏览器。"""
from __future__ import annotations

import argparse
import ctypes
import logging
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

import pystray
from PIL import Image

from . import config, db

MUTEX_NAME = "Local\\ActivityPhotoCull_SingleInstance_v1"
ACTIVATE_EVENT_NAME = "Local\\ActivityPhotoCull_Activate_v1"
ERROR_ALREADY_EXISTS = 183
# 第二个进程只负责唤醒已运行的实例，不再弹“程序已经在运行”。
_activate_event = None


def _dpi_aware() -> None:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def _message(text: str, title: str | None = None) -> None:
    try:
        ctypes.windll.user32.MessageBoxW(None, text, title or config.APP_DISPLAY_NAME, 0x40)
    except Exception:
        print(text)


def _activate_running_instance() -> bool:
    """Signal the first instance to restore/focus its existing window."""
    kernel32 = ctypes.windll.kernel32
    try:
        kernel32.OpenEventW.argtypes = [ctypes.c_uint32, ctypes.c_bool, ctypes.c_wchar_p]
        kernel32.OpenEventW.restype = ctypes.c_void_p
        kernel32.SetEvent.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        event = kernel32.OpenEventW(0x0002, False, ACTIVATE_EVENT_NAME)  # EVENT_MODIFY_STATE
        if event:
            kernel32.SetEvent(event)
            kernel32.CloseHandle(event)
            return True
    except Exception:
        logging.debug("signal activate event failed", exc_info=True)
    # Fallback for an older running build or if the event disappeared.
    try:
        user32 = ctypes.windll.user32
        hwnd = user32.FindWindowW(None, config.APP_DISPLAY_NAME)
        if hwnd:
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            user32.SetForegroundWindow(hwnd)
            return True
    except Exception:
        logging.debug("fallback activate window failed", exc_info=True)
    return False


def _single_instance():
    global _activate_event
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
        if not _activate_running_instance():
            _message("程序已经在运行，请查看任务栏中已打开的窗口。")
        return None
    try:
        kernel32.CreateEventW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_bool, ctypes.c_wchar_p]
        kernel32.CreateEventW.restype = ctypes.c_void_p
        _activate_event = kernel32.CreateEventW(None, False, False, ACTIVATE_EVENT_NAME)
    except Exception:
        logging.debug("create activate event failed", exc_info=True)
    return handle


def _free_port() -> int:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]
    finally:
        sock.close()


def _wait_ready(url: str, timeout: float = 25.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url + "api/health", timeout=1) as response:
                if response.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.15)
    return False


def _start_server(port: int):
    import uvicorn
    from .api import app

    server = uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", port=port, log_level="warning", access_log=False,
    ))
    threading.Thread(target=server.run, daemon=True).start()
    return server


def _configure_webview2_gpu() -> None:
    """Ask WebView2 to use the real GPU compositor instead of software fallback."""
    flags = [
        "--enable-gpu-rasterization",
        "--enable-zero-copy",
        "--ignore-gpu-blocklist",
        "--enable-accelerated-2d-canvas",
        "--enable-accelerated-video-decode",
    ]
    previous = os.environ.get("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "").strip()
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = " ".join(flags + ([previous] if previous else []))


_window_shown = False


def _show_window(window) -> None:
    global _window_shown
    try:
        if _window_shown:
            return
        _window_shown = True
        window.show()
        window.maximize()
    except Exception:
        logging.exception("show window failed")


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.FileHandler(os.path.join(config.logs_dir(), "app.log"), encoding="utf-8")],
    )


def _find_edge() -> str | None:
    candidates = [
        os.path.join(os.environ.get("ProgramFiles(x86)", ""), "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(os.environ.get("ProgramFiles", ""), "Microsoft", "Edge", "Application", "msedge.exe"),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return shutil.which("msedge")


def _open_fallback(url: str, server) -> None:
    """没有 WebView2 时，用 Edge 的应用窗口；再不行用默认浏览器。"""
    edge = _find_edge()
    if edge:
        profile = os.path.join(config.data_dir(), "edge-app")
        try:
            process = subprocess.Popen([
                edge, f"--app={url}", "--window-size=1440,900",
                "--enable-gpu-rasterization", "--enable-zero-copy", "--ignore-gpu-blocklist",
                f"--user-data-dir={profile}", "--no-first-run",
            ])
            process.wait()
            server.should_exit = True
            return
        except Exception:
            logging.exception("Edge app window failed")
    webbrowser.open(url)
    _message("无法创建程序窗口，已用默认浏览器打开。关闭浏览器后可在任务管理器中结束本程序。")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    server.should_exit = True



_desktop_window = None
_window_maximized = True
_window_fullscreen = False
_native_drag_lock = threading.Lock()
_close_mode = "quit"          # quit = 完全关闭；background = 留在后台
_force_quit = False
_tray_icon = None
_tray_lock = threading.Lock()
_server = None


def _tray_image():
    """托盘图标优先使用程序自带 png，失败时用纯色占位。"""
    candidates = [
        os.path.join(config.web_dir(), "icon.png"),
        os.path.join(config.app_dir(), "app", "web", "icon.png"),
    ]
    for path in candidates:
        try:
            if os.path.isfile(path):
                return Image.open(path).convert("RGBA")
        except Exception:
            pass
    return Image.new("RGBA", (64, 64), (44, 142, 255, 255))


def _stop_tray() -> None:
    global _tray_icon
    with _tray_lock:
        icon = _tray_icon
        _tray_icon = None
    if icon is not None:
        try:
            icon.stop()
        except Exception:
            logging.debug("tray stop failed", exc_info=True)


def _restore_window(window) -> None:
    _stop_tray()
    try:
        window.show()
        window.restore()
        window.maximize()
    except Exception:
        logging.debug("restore from tray failed", exc_info=True)


def _quit_from_tray(window) -> None:
    global _force_quit
    _force_quit = True
    _stop_tray()
    try:
        window.destroy()
    except Exception:
        logging.debug("quit from tray failed", exc_info=True)
    try:
        if _server is not None:
            _server.should_exit = True
    except Exception:
        pass


def _ensure_tray(window) -> None:
    global _tray_icon
    with _tray_lock:
        if _tray_icon is not None:
            return
    try:
        def show(_icon, _item):
            threading.Thread(target=_restore_window, args=(window,), daemon=True).start()

        def quit_app(_icon, _item):
            threading.Thread(target=_quit_from_tray, args=(window,), daemon=True).start()

        icon = pystray.Icon(
            "ActivityPhotoCull",
            _tray_image(),
            config.APP_DISPLAY_NAME,
            pystray.Menu(
                pystray.MenuItem("显示拾影", show, default=True),
                pystray.MenuItem("完全退出", quit_app),
            ),
        )
        with _tray_lock:
            _tray_icon = icon
        threading.Thread(target=icon.run, name="shiyin-tray", daemon=True).start()
    except Exception:
        logging.exception("create tray icon failed")


def _hide_to_tray(window) -> None:
    try:
        window.hide()
    except Exception:
        logging.debug("hide window failed", exc_info=True)
    _ensure_tray(window)


def _focus_window(window) -> None:
    try:
        hwnd = _window_handle(window)
        if not hwnd:
            return
        user32 = ctypes.windll.user32
        user32.ShowWindow(hwnd, 9)
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
    except Exception:
        logging.debug("focus window failed", exc_info=True)


def _watch_activate_event(window) -> None:
    if not _activate_event:
        return
    kernel32 = ctypes.windll.kernel32
    try:
        kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        kernel32.WaitForSingleObject.restype = ctypes.c_uint32
        while not _force_quit:
            if kernel32.WaitForSingleObject(_activate_event, 500) == 0:  # WAIT_OBJECT_0
                _restore_window(window)
                _focus_window(window)
    except Exception:
        logging.debug("activate watcher stopped", exc_info=True)


def _on_window_closing() -> bool:
    """Alt+F4 / 原生关闭：后台模式拦截关闭，改为最小化到托盘。"""
    if not _force_quit and _close_mode == "background" and _desktop_window is not None:
        _hide_to_tray(_desktop_window)
        return False
    _stop_tray()
    return True


def _window_handle(window=None):
    """Use this window's handle; never move another instance with the same title."""
    window = window or _desktop_window
    if window is None:
        return None
    try:
        return int(window.native.Handle.ToInt64())
    except (AttributeError, TypeError):
        try:
            return int(window.native.Handle)
        except (AttributeError, TypeError, ValueError):
            return None


def _window_state() -> dict:
    global _window_maximized
    hwnd = _window_handle()
    if hwnd:
        user32 = ctypes.windll.user32
        user32.IsZoomed.argtypes = [ctypes.c_void_p]
        _window_maximized = bool(user32.IsZoomed(hwnd))
    return {"maximized": _window_maximized, "fullscreen": _window_fullscreen}


def window_action(action: str, value: str | None = None) -> dict:
    """自绘窗口按钮；由 pywebview 通过 window.expose 暴露给网页。"""
    global _window_maximized, _window_fullscreen
    window = _desktop_window
    if not window:
        return {"maximized": _window_maximized, "fullscreen": _window_fullscreen}
    if action == "minimize":
        window.minimize()
    elif action == "toggle_maximize":
        if _window_fullscreen:
            window.toggle_fullscreen()
            _window_fullscreen = False
            _attach_native_borderless(window)
        if _window_state()["maximized"]:
            window.restore()
            _window_maximized = False
        else:
            window.maximize()
            _window_maximized = True
    elif action == "toggle_fullscreen":
        window.toggle_fullscreen()
        _window_fullscreen = not _window_fullscreen
        if not _window_fullscreen:
            _attach_native_borderless(window)
    elif action == "set_close_mode":
        global _close_mode
        _close_mode = "background" if str(value or "").strip() == "background" else "quit"
    elif action == "close":
        if _close_mode == "background":
            _hide_to_tray(window)
        else:
            _stop_tray()
            window.destroy()
    elif action == "set_border":
        try:
            color = (value or "#20252a").strip()
            if color.lower() in ("none", "transparent"):
                hwnd = _window_handle(window)
                if hwnd:
                    value_ref = ctypes.c_int(-2)  # DWMWA_COLOR_NONE
                    ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 34, ctypes.byref(value_ref), 4)
                    _apply_window_region(hwnd)
                return None
            if color.startswith("#") and len(color) == 7:
                r, g, b = int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)
            elif color.startswith("rgb"):
                nums = color[color.find("(") + 1:color.find(")")].replace("%", "").split(",")
                r, g, b = (int(float(n.strip())) for n in nums[:3])
            else:
                r, g, b = 32, 37, 42
            colorref = (b << 16) | (g << 8) | r
            hwnd = _window_handle(window)
            if hwnd:
                value_ref = ctypes.c_int(colorref)
                ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 34, ctypes.byref(value_ref), 4)
                _apply_window_region(hwnd)
        except Exception:
            logging.debug("set border color failed", exc_info=True)
    elif action == "drag":
        if _window_fullscreen:
            window.toggle_fullscreen()
            _window_fullscreen = False
            _attach_native_borderless(window)
        _queue_native_drag()
    return _window_state()


def _tint_native_frame(window) -> None:
    """把 Windows 原生标题栏/边框调成界面同色，消除顶部白边。"""
    try:
        hwnd = ctypes.windll.user32.FindWindowW(None, config.APP_DISPLAY_NAME)
        if not hwnd:
            hwnd = int(window.native.Handle)
        dwm = ctypes.windll.dwmapi

        def set_attr(attr: int, color: int) -> None:
            value = ctypes.c_int(color)
            dwm.DwmSetWindowAttribute(hwnd, attr, ctypes.byref(value), ctypes.sizeof(value))

        set_attr(20, 0)          # DWMWA_USE_IMMERSIVE_DARK_MODE = false
        set_attr(35, 0x00F2F4F3) # caption #f3f4f2
        set_attr(34, -2)         # DWMWA_COLOR_NONE: no outer border
        set_attr(36, 0x002A2520) # text #20252a
    except Exception:
        logging.debug("native frame tint unavailable", exc_info=True)


def _make_borderless(window) -> None:
    """移除原生标题栏/白边；WebView2 内容保持完整，由页面自绘窗口控制。"""
    try:
        user32 = ctypes.windll.user32
        user32.FindWindowW.restype = ctypes.c_void_p
        hwnd = user32.FindWindowW(None, config.APP_DISPLAY_NAME)
        if not hwnd:
            hwnd = int(window.native.Handle)
        style = user32.GetWindowLongW(hwnd, -16)
        logging.warning("borderless probe hwnd=%s style=%#x", hwnd, style)
        # WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX
        style &= ~(0x00C00000 | 0x00040000 | 0x00080000 | 0x00020000 | 0x00010000)
        logging.warning("borderless set style=%#x", style)
        user32.SetWindowLongW(hwnd, -16, style)
        SWP_NOSIZE, SWP_NOMOVE, SWP_NOZORDER, SWP_FRAMECHANGED = 0x0001, 0x0002, 0x0004, 0x0020
        user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_FRAMECHANGED)
        user32.ShowWindow(hwnd, 3)  # SW_MAXIMIZE
    except Exception:
        logging.debug("borderless window unavailable", exc_info=True)


def _fit_frameless(window) -> None:
    """无边框窗口铺满屏幕；同时确保窗口从最小化/隐藏状态显示出来。"""
    try:
        user32 = ctypes.windll.user32
        hwnd = 0
        try:
            hwnd = int(window.native.Handle)
        except Exception:
            hwnd = 0
        if not hwnd:
            user32.FindWindowW.restype = ctypes.c_void_p
            hwnd = user32.FindWindowW(None, config.APP_DISPLAY_NAME)
        if not hwnd:
            return
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        width = user32.GetSystemMetrics(0)
        height = user32.GetSystemMetrics(1)
        SWP_SHOWWINDOW, SWP_NOZORDER = 0x0040, 0x0004
        user32.SetWindowPos(hwnd, 0, 0, 0, width, height, SWP_SHOWWINDOW | SWP_NOZORDER)
        user32.ShowWindow(hwnd, 9)
        user32.SetForegroundWindow(hwnd)
    except Exception:
        logging.debug("frameless fit unavailable", exc_info=True)


def _queue_native_drag() -> None:
    """Queue one native caption gesture. Windows owns restore, movement and snap."""
    if not _native_borderless_ready or not _native_drag_lock.acquire(blocking=False):
        return
    queued = False
    try:
        hwnd = _window_handle()
        user32 = ctypes.windll.user32
        # A delayed bridge message must not start a drag after the button is released.
        if not hwnd or not user32.GetAsyncKeyState(0x01) & 0x8000:
            return
        from ctypes import wintypes
        point = wintypes.POINT()
        user32.GetCursorPos(ctypes.byref(point))
        position = (point.x & 0xffff) | ((point.y & 0xffff) << 16)
        user32.PostMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]
        user32.PostMessageW.restype = ctypes.c_int
        queued = bool(user32.PostMessageW(hwnd, 0x00A1, HTCAPTION, position))
    except Exception:
        logging.debug("native window drag failed", exc_info=True)
    finally:
        if not queued:
            _native_drag_lock.release()


_native_original_wndproc = None
_native_wndproc = None
_native_frame_ready = False

WM_NCHITTEST = 0x0084
HTCAPTION = 2
HTCLIENT = 1


def _prepare_native_frame(window) -> None:
    """只移除原生标题栏，保留 WS_THICKFRAME / 最大化状态，系统交互交给 Windows。"""
    global _native_frame_ready
    if _native_frame_ready:
        return
    try:
        user32 = ctypes.windll.user32
        user32.FindWindowW.restype = ctypes.c_void_p
        hwnd = user32.FindWindowW(None, config.APP_DISPLAY_NAME)
        if not hwnd:
            return
        style = user32.GetWindowLongW(hwnd, -16)
        style |= 0x00040000 | 0x00080000 | 0x00020000 | 0x00010000
        style &= ~0x00C00000  # remove WS_CAPTION, keep native resize/snap
        user32.SetWindowLongW(hwnd, -16, style)
        user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0x0027)  # NOSIZE|NOMOVE|NOZORDER|FRAMECHANGED
        _native_frame_ready = True
    except Exception:
        logging.debug("native frame prep failed", exc_info=True)


_native_proc_ref = None
_native_orig_proc = None
_native_borderless_ready = False
_native_borderless_hwnd = None



def _apply_window_region(hwnd) -> None:
    """Clip the 1px DWM frame by insetting the window region one pixel.

    Windows 11 keeps drawing a 1px system border around thick-frame windows even
    after DWMWA_COLOR_NONE. A rounded window region removes that last line.
    """
    try:
        user32 = ctypes.windll.user32
        if not hwnd or not user32.IsWindow(hwnd):
            return
        user32.GetWindowRect.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        rect = (ctypes.c_long * 4)()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return
        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        if width <= 4 or height <= 4:
            return
        try:
            scale = user32.GetDpiForWindow(hwnd) / 96.0
        except Exception:
            scale = 1.0
        inset = 1
        radius = 0 if user32.IsZoomed(hwnd) else max(2, int(14 * scale))
        gdi32 = ctypes.windll.gdi32
        gdi32.CreateRoundRectRgn.restype = ctypes.c_void_p
        user32.SetWindowRgn.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int]
        rgn = gdi32.CreateRoundRectRgn(inset, inset, width - inset, height - inset, radius, radius)
        if rgn:
            user32.SetWindowRgn(hwnd, rgn, 1)
    except Exception:
        logging.debug("window region unavailable", exc_info=True)

def _attach_native_borderless(window) -> None:
    """标准窗口只隐藏标题栏；保留 WS_THICKFRAME 与系统最大化/贴边，不接管窗口尺寸。"""
    global _native_proc_ref, _native_orig_proc, _native_borderless_ready, _native_borderless_hwnd
    try:
        user32 = ctypes.windll.user32
        hwnd = _window_handle(window)
        if not hwnd:
            return
        user32.GetWindowLongW.argtypes = [ctypes.c_void_p, ctypes.c_int]
        user32.SetWindowLongW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_long]
        user32.SetWindowPos.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
                                       ctypes.c_int, ctypes.c_int, ctypes.c_uint]
        user32.GetWindowRect.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        user32.IsZoomed.argtypes = [ctypes.c_void_p]
        user32.GetDpiForWindow.argtypes = [ctypes.c_void_p]

        style = user32.GetWindowLongW(hwnd, -16)
        style |= 0x00040000 | 0x00080000 | 0x00020000 | 0x00010000
        style &= ~0x00C00000
        user32.SetWindowLongW(hwnd, -16, style)
        user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0x0027)
        try:
            dwm = ctypes.windll.dwmapi
            dwm.DwmSetWindowAttribute.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]
            dwm.DwmExtendFrameIntoClientArea.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
            no_border = ctypes.c_int(-2)  # DWMWA_COLOR_NONE
            dwm.DwmSetWindowAttribute(hwnd, 34, ctypes.byref(no_border), 4)
            round_corners = ctypes.c_int(2)  # DWMWCP_ROUND
            dwm.DwmSetWindowAttribute(hwnd, 33, ctypes.byref(round_corners), 4)

            class MARGINS(ctypes.Structure):
                _fields_ = [("cxLeftWidth", ctypes.c_int), ("cxRightWidth", ctypes.c_int),
                            ("cyTopHeight", ctypes.c_int), ("cyBottomHeight", ctypes.c_int)]
            # Non-client space is handled below. Extending glass over the entire
            # WebView leaves an extra DWM surface behind the client window.
            dwm.DwmExtendFrameIntoClientArea(hwnd, ctypes.byref(MARGINS(0, 0, 0, 0)))
        except Exception:
            pass
        _apply_window_region(hwnd)
        # Fullscreen can restore the Form border style or recreate its handle.
        # Reapply the style, but never install our own WndProc twice on one handle.
        if _native_borderless_ready and _native_borderless_hwnd == hwnd:
            return

        LRESULT = ctypes.c_ssize_t
        WNDPROC = ctypes.WINFUNCTYPE(LRESULT, ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p)
        user32.CallWindowProcW.restype = LRESULT
        user32.CallWindowProcW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
        user32.SetWindowLongPtrW.restype = ctypes.c_void_p
        user32.SetWindowLongPtrW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]

        class POINT(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

        class RECT(ctypes.Structure):
            _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                        ("right", ctypes.c_long), ("bottom", ctypes.c_long)]

        class MONITORINFO(ctypes.Structure):
            _fields_ = [("cbSize", ctypes.c_uint), ("rcMonitor", RECT),
                        ("rcWork", RECT), ("dwFlags", ctypes.c_uint)]

        user32.MonitorFromWindow.argtypes = [ctypes.c_void_p, ctypes.c_uint]
        user32.MonitorFromWindow.restype = ctypes.c_void_p
        user32.GetMonitorInfoW.argtypes = [ctypes.c_void_p, ctypes.c_void_p]

        def wndproc(h, msg, wparam, lparam):
            global _window_maximized
            if msg == 0x0083 and lparam:  # WM_NCCALCSIZE: the page owns every client pixel.
                # rgrc[0] is the first RECT in NCCALCSIZE_PARAMS; FALSE uses RECT directly.
                client = ctypes.cast(lparam, ctypes.POINTER(RECT)).contents
                if user32.IsZoomed(h):
                    monitor = MONITORINFO()
                    monitor.cbSize = ctypes.sizeof(monitor)
                    if user32.GetMonitorInfoW(user32.MonitorFromWindow(h, 2), ctypes.byref(monitor)):
                        work = monitor.rcMonitor if _window_fullscreen else monitor.rcWork
                        client.left, client.top = work.left, work.top
                        client.right, client.bottom = work.right, work.bottom
                return 0
            if msg == 0x0005 and wparam != 1:  # WM_SIZE, leave state alone while minimized
                _window_maximized = wparam == 2
                _apply_window_region(h)
            if msg == 0x00A1 and wparam == HTCAPTION:
                try:
                    if not user32.GetAsyncKeyState(0x01) & 0x8000:
                        return 0
                    # Release WebView2's capture on the owning UI thread, then enter
                    # the system move loop once (including drag-to-restore and snap).
                    user32.ReleaseCapture()
                    return user32.CallWindowProcW(_native_orig_proc, h, msg, wparam, lparam)
                finally:
                    if _native_drag_lock.locked():
                        _native_drag_lock.release()
            if msg == 0x0084:  # WM_NCHITTEST
                # WM_NCHITTEST supplies signed screen coordinates (also on monitors
                # to the left/above the primary display).
                position = lparam or 0
                cursor = POINT(ctypes.c_short(position & 0xffff).value,
                               ctypes.c_short((position >> 16) & 0xffff).value)
                rect = RECT()
                user32.GetWindowRect(h, ctypes.byref(rect))
                try:
                    scale = user32.GetDpiForWindow(h) / 96.0
                except Exception:
                    scale = 1.0
                if user32.IsZoomed(h):
                    if rect.top <= cursor.y < rect.top + int(20 * scale):
                        return HTCAPTION
                    return HTCLIENT
                edge = max(6, int(8 * scale))
                left = cursor.x < rect.left + edge
                right = cursor.x >= rect.right - edge
                top = cursor.y < rect.top + edge
                bottom = cursor.y >= rect.bottom - edge
                # 四角优先
                if top and left:
                    return 13  # HTTOPLEFT
                if top and right:
                    return 14  # HTTOPRIGHT
                if bottom and left:
                    return 16  # HTBOTTOMLEFT
                if bottom and right:
                    return 17  # HTBOTTOMRIGHT
                if left:
                    return 10  # HTLEFT
                if right:
                    return 11  # HTRIGHT
                if top:
                    return 12  # HTTOP
                if bottom:
                    return 15  # HTBOTTOM
                if rect.left <= cursor.x < rect.right and rect.top <= cursor.y < rect.top + int(20 * scale):
                    return 2  # HTCAPTION, native drag/snap/restore
                return user32.CallWindowProcW(_native_orig_proc, h, msg, wparam, lparam)
            return user32.CallWindowProcW(_native_orig_proc, h, msg, wparam, lparam)

        proc_ref = WNDPROC(wndproc)
        old = user32.SetWindowLongPtrW(hwnd, -4, ctypes.cast(proc_ref, ctypes.c_void_p))
        _native_orig_proc = old
        _native_proc_ref = proc_ref
        _native_borderless_hwnd = hwnd
        _native_borderless_ready = True
        # Recalculate after subclassing, otherwise Windows keeps the old 31px
        # caption/8px border cached even though the caption style was removed.
        user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0x0027)
    except Exception:
        logging.debug("borderless attach failed", exc_info=True)


def _keep_titlebar_tinted(window) -> None:
    """持续维持原生标题栏颜色，窗口最大化/还原后也不会变回白色。"""
    while True:
        try:
            _style_native_titlebar(window)
        except Exception:
            pass
        time.sleep(1.2)


def _style_native_titlebar(window) -> None:
    """标准 Windows 窗口：保留系统标题栏/缩放/贴边，只把标题栏和边框染成界面底色。"""
    try:
        user32 = ctypes.windll.user32
        user32.FindWindowW.restype = ctypes.c_void_p
        hwnd = user32.FindWindowW(None, config.APP_DISPLAY_NAME)
        if not hwnd:
            hwnd = int(window.native.Handle)
        if not hwnd:
            return
        dwm = ctypes.windll.dwmapi

        def set_attr(attr: int, color: int) -> None:
            value = ctypes.c_int(color)
            dwm.DwmSetWindowAttribute(hwnd, attr, ctypes.byref(value), ctypes.sizeof(value))

        set_attr(20, 0)          # light titlebar
        set_attr(35, 0x00F2F4F3) # caption #f3f4f2
        set_attr(34, 0x00E4E7E9) # border  #e9e7e4
        set_attr(36, 0x002A2520) # text    #20252a
    except Exception:
        logging.debug("titlebar tint unavailable", exc_info=True)


def _remove_native_titlebar(window) -> None:
    """去掉系统标题栏，保留 WS_THICKFRAME 缩放和系统窗口状态；拖动由顶部自绘条处理。"""
    try:
        user32 = ctypes.windll.user32
        user32.FindWindowW.restype = ctypes.c_void_p
        hwnd = user32.FindWindowW(None, config.APP_DISPLAY_NAME)
        if not hwnd:
            hwnd = int(window.native.Handle)
        if not hwnd:
            return
        style = user32.GetWindowLongW(hwnd, -16)
        style |= 0x00040000 | 0x00080000 | 0x00020000 | 0x00010000
        style &= ~0x00C00000
        user32.SetWindowLongW(hwnd, -16, style)
        user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0x0027)
        try:
            dwm = ctypes.windll.dwmapi
            value = ctypes.c_int(0x00F2F4F3)
            dwm.DwmSetWindowAttribute(hwnd, 34, ctypes.byref(value), 4)  # border = canvas
        except Exception:
            pass
    except Exception:
        logging.debug("remove titlebar failed", exc_info=True)


def _show_native_window(window) -> None:
    global _window_maximized
    try:
        user32 = ctypes.windll.user32
        user32.FindWindowW.restype = ctypes.c_void_p
        hwnd = user32.FindWindowW(None, config.APP_DISPLAY_NAME)
        if not hwnd:
            hwnd = int(window.native.Handle)
        if hwnd:
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE，保持 1440x900 正常窗口
            user32.SetForegroundWindow(hwnd)
            _window_maximized = False
    except Exception:
        logging.debug("show native window failed", exc_info=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=config.APP_DISPLAY_NAME)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--browser", action="store_true", help="使用默认浏览器而不是原生窗口")
    args = parser.parse_args(argv)

    _configure_webview2_gpu()
    _dpi_aware()
    _setup_logging()
    mutex = _single_instance()
    if mutex is None:
        return 0
    db.init_db()

    port = args.port or _free_port()
    url = f"http://127.0.0.1:{port}/?v={config.VERSION}"
    server = _start_server(port)
    if not _wait_ready(url):
        logging.error("local server did not become ready")
        _message("程序启动失败：本地服务没有就绪。详情见日志目录：\n" + config.logs_dir())
        return 1

    if args.browser:
        webbrowser.open(url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        server.should_exit = True
        return 0

    try:
        import webview

        global _desktop_window
        window = webview.create_window(
            config.APP_DISPLAY_NAME,
            url,
            width=1440,
            height=900,
            min_size=(1100, 700),
            maximized=False,
            easy_drag=False,
            background_color="#f3f4f2",
            text_select=True,
            confirm_close=False,
        )
        global _server
        _server = server
        _desktop_window = window
        window.expose(window_action)
        window.events.closing += _on_window_closing
        # Install on the UI thread before display. Delayed restore timers used to
        # fight a user's drag/maximize and briefly show a different window size.
        window.events.before_show += lambda: _attach_native_borderless(window)
        window.events.closed += lambda: setattr(server, "should_exit", True)
        window.events.loaded += lambda: threading.Thread(
            target=_watch_activate_event, args=(window,), daemon=True,
        ).start()
        webview.start(
            private_mode=False,
            storage_path=os.path.join(config.data_dir(), "webview"),
            icon=os.path.join(config.resource_dir(), "app", "web", "icon.ico"),
        )
    except Exception as exc:
        logging.exception("native window failed, falling back")
        _message(f"无法创建程序窗口（{exc}）。将尝试用 Edge 应用窗口打开。")
        _open_fallback(url, server)
    finally:
        _stop_tray()
        server.should_exit = True
    return 0


if __name__ == "__main__":
    sys.exit(main())


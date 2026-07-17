"""Native Win32 scan-area outline (Windows only — never import elsewhere).

The positioning overlay CANNOT be a pywebview window on Windows: WebView2
takes keyboard focus on any click no matter what extended styles the host
window carries, and classic fullscreen games (SWG) minimize the moment they
lose focus — so touching the overlay alt-tabbed the player out. A raw Win32
window sidesteps the whole problem:

  * WM_MOUSEACTIVATE → MA_NOACTIVATE: interacting never activates ANY window,
    so the game keeps focus the entire time — drag, resize, everything.
  * WM_NCHITTEST maps the interior to HTCAPTION (OS-native window drag) and an
    8px band to the resize hit codes (OS-native edge/corner resize) — no
    focus, no JS bridge, no WebView.
  * WS_EX_LAYERED alpha makes the outline see-through, so the game's Examine
    window stays readable while fitting the outline over it.

Geometry is EXACT physical pixels end to end — created from and committed
back to the same rect — none of the logical/physical int() round-trips that
made the pywebview frame shrink a little on every open/close cycle.

The window runs on its own message-pump thread. close() posts WM_CLOSE; the
WM_CLOSE handler snapshots the final rect and hands it to on_commit before
the window dies, so the fit is saved however the outline gets dismissed.
"""
from __future__ import annotations

import ctypes
import logging
import threading
from ctypes import wintypes
from typing import Callable, Optional

logger = logging.getLogger(__name__)

_user32 = ctypes.windll.user32
_gdi32 = ctypes.windll.gdi32
_kernel32 = ctypes.windll.kernel32

_CLASS_NAME = "SWGTrackerScanOverlay"

WS_POPUP = 0x80000000
WS_EX_TOPMOST = 0x00000008
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_LAYERED = 0x00080000
WS_EX_NOACTIVATE = 0x08000000

WM_DESTROY = 0x0002
WM_PAINT = 0x000F
WM_CLOSE = 0x0010
WM_ERASEBKGND = 0x0014
WM_GETMINMAXINFO = 0x0024
WM_MOUSEACTIVATE = 0x0021
WM_NCHITTEST = 0x0084

MA_NOACTIVATE = 3
# WM_NCHITTEST result grid, [row][col] for (top,mid,bottom) x (left,mid,right).
# Interior is HTCAPTION: the OS moves the window for us, activation-free.
_HITS = ((13, 12, 14),  # HTTOPLEFT,    HTTOP,     HTTOPRIGHT
         (10, 2, 11),   # HTLEFT,       HTCAPTION, HTRIGHT
         (16, 15, 17))  # HTBOTTOMLEFT, HTBOTTOM,  HTBOTTOMRIGHT
_GRIP = 8  # px band that counts as an edge

_BG = 0x0014100E     # app dark #0e1014 as COLORREF (BGR)
_ACCENT = 0x005043E2  # accent red #e24350 (BGR)
_TEXT = 0x00DAD3CD    # light gray #cdd3da (BGR)
_ALPHA = 205          # whole-window opacity — the game shows through

_HINT = ("Scan area — everything inside gets scanned.\n\n"
         "Drag to move.  Drag an edge or corner to resize.\n\n"
         "The overlay hotkey (or “Position scan area” in the app) puts this "
         "away and saves the fit. The scan hotkey captures this exact spot.")

_LRESULT = ctypes.c_ssize_t
_WNDPROC = ctypes.WINFUNCTYPE(_LRESULT, wintypes.HWND, wintypes.UINT,
                              wintypes.WPARAM, wintypes.LPARAM)

_user32.DefWindowProcW.restype = _LRESULT
_user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT,
                                   wintypes.WPARAM, wintypes.LPARAM]
_user32.CreateWindowExW.restype = wintypes.HWND
_user32.CreateWindowExW.argtypes = [
    wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
    ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
    wintypes.HWND, ctypes.c_void_p, wintypes.HINSTANCE, ctypes.c_void_p]
_user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT,
                                 wintypes.WPARAM, wintypes.LPARAM]
_user32.LoadCursorW.restype = ctypes.c_void_p
_user32.LoadCursorW.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
_user32.BeginPaint.restype = ctypes.c_void_p
_user32.DrawTextW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR, ctypes.c_int,
                              ctypes.c_void_p, wintypes.UINT]
_gdi32.CreateSolidBrush.restype = ctypes.c_void_p
_gdi32.GetStockObject.restype = ctypes.c_void_p
_gdi32.SelectObject.restype = ctypes.c_void_p
_gdi32.SelectObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]


class _WNDCLASSW(ctypes.Structure):
    _fields_ = [("style", wintypes.UINT), ("lpfnWndProc", _WNDPROC),
                ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int),
                ("hInstance", wintypes.HINSTANCE), ("hIcon", ctypes.c_void_p),
                ("hCursor", ctypes.c_void_p), ("hbrBackground", ctypes.c_void_p),
                ("lpszMenuName", wintypes.LPCWSTR), ("lpszClassName", wintypes.LPCWSTR)]


class _PAINTSTRUCT(ctypes.Structure):
    _fields_ = [("hdc", ctypes.c_void_p), ("fErase", wintypes.BOOL),
                ("rcPaint", wintypes.RECT), ("fRestore", wintypes.BOOL),
                ("fIncUpdate", wintypes.BOOL), ("rgbReserved", ctypes.c_byte * 32)]


class _MINMAXINFO(ctypes.Structure):
    _fields_ = [("ptReserved", wintypes.POINT), ("ptMaxSize", wintypes.POINT),
                ("ptMaxPosition", wintypes.POINT),
                ("ptMinTrackSize", wintypes.POINT),
                ("ptMaxTrackSize", wintypes.POINT)]


_registered = False
_class_proc = None  # the registered class's WNDPROC — GC'd = crash


def _register_class() -> None:
    global _registered, _class_proc
    if _registered:
        return
    _class_proc = _WNDPROC(
        lambda h, m, w, l: _user32.DefWindowProcW(h, m, w, l))
    wc = _WNDCLASSW()
    wc.style = 0x0003  # CS_HREDRAW | CS_VREDRAW — full repaint on resize
    wc.lpfnWndProc = _class_proc  # instances subclass with their own proc
    wc.hInstance = _kernel32.GetModuleHandleW(None)
    wc.hCursor = _user32.LoadCursorW(None, 32512)  # IDC_ARROW
    wc.lpszClassName = _CLASS_NAME
    # 0 return usually means "already registered" (a prior thread) — usable;
    # if the class is truly missing, CreateWindowExW fails loudly right after.
    _user32.RegisterClassW(ctypes.byref(wc))
    _registered = True


def _subclass(hwnd, proc: "_WNDPROC") -> None:
    fn = getattr(_user32, "SetWindowLongPtrW", None) or _user32.SetWindowLongW
    fn.restype = _LRESULT
    fn.argtypes = [wintypes.HWND, ctypes.c_int, _WNDPROC]
    fn(hwnd, -4, proc)  # GWLP_WNDPROC


class Overlay:
    """One outline window. show() spawns the pump thread; close() commits the
    final rect (physical px) through on_commit and tears the window down."""

    def __init__(self, rect: tuple, on_commit: Callable[[tuple], None]):
        self._rect = tuple(int(v) for v in rect)  # (x, y, w, h) physical px
        self._on_commit = on_commit
        self._hwnd = None
        self._thread: Optional[threading.Thread] = None
        self._wndproc = None  # keep the callback alive for the window's life

    @property
    def visible(self) -> bool:
        return bool(self._thread is not None and self._thread.is_alive())

    def show(self) -> None:
        if self.visible:
            return
        self._thread = threading.Thread(target=self._run, name="scan-overlay",
                                        daemon=True)
        self._thread.start()

    def close(self) -> None:
        hwnd = self._hwnd
        if hwnd:
            _user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)

    # ------------------------------------------------------------ internals

    def _run(self) -> None:
        try:
            _register_class()
            x, y, w, h = self._rect
            hwnd = _user32.CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_LAYERED | WS_EX_NOACTIVATE,
                _CLASS_NAME, "Scan area", WS_POPUP, x, y, w, h,
                None, None, _kernel32.GetModuleHandleW(None), None)
            if not hwnd:
                logger.error("scan overlay: CreateWindowExW failed")
                return
            self._hwnd = hwnd
            self._wndproc = _WNDPROC(self._proc)
            _subclass(hwnd, self._wndproc)
            _user32.SetLayeredWindowAttributes(hwnd, 0, _ALPHA, 2)  # LWA_ALPHA
            _user32.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE
            _user32.UpdateWindow(hwnd)
            msg = wintypes.MSG()
            while _user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                _user32.TranslateMessage(ctypes.byref(msg))
                _user32.DispatchMessageW(ctypes.byref(msg))
        except Exception:  # noqa: BLE001 — overlay death must not hurt the app
            logger.error("scan overlay crashed", exc_info=True)
        finally:
            self._hwnd = None
            self._wndproc = None

    def _proc(self, hwnd, msg, wp, lp):
        if msg == WM_MOUSEACTIVATE:
            return MA_NOACTIVATE  # THE point of this window
        if msg == WM_NCHITTEST:
            x = ctypes.c_short(lp & 0xFFFF).value
            y = ctypes.c_short((lp >> 16) & 0xFFFF).value
            r = wintypes.RECT()
            _user32.GetWindowRect(hwnd, ctypes.byref(r))
            row = 0 if y < r.top + _GRIP else (2 if y >= r.bottom - _GRIP else 1)
            col = 0 if x < r.left + _GRIP else (2 if x >= r.right - _GRIP else 1)
            return _HITS[row][col]
        if msg == WM_GETMINMAXINFO:
            mmi = ctypes.cast(lp, ctypes.POINTER(_MINMAXINFO)).contents
            mmi.ptMinTrackSize = wintypes.POINT(160, 120)
            return 0
        if msg == WM_ERASEBKGND:
            return 1  # painted fully in WM_PAINT — avoid flicker
        if msg == WM_PAINT:
            self._paint(hwnd)
            return 0
        if msg == WM_CLOSE:
            r = wintypes.RECT()
            if _user32.GetWindowRect(hwnd, ctypes.byref(r)):
                try:
                    self._on_commit((r.left, r.top,
                                     r.right - r.left, r.bottom - r.top))
                except Exception:  # noqa: BLE001
                    logger.error("scan overlay commit failed", exc_info=True)
            _user32.DestroyWindow(hwnd)
            return 0
        if msg == WM_DESTROY:
            _user32.PostQuitMessage(0)
            return 0
        return _user32.DefWindowProcW(hwnd, msg, wp, lp)

    def _paint(self, hwnd) -> None:
        ps = _PAINTSTRUCT()
        hdc = _user32.BeginPaint(hwnd, ctypes.byref(ps))
        try:
            rc = wintypes.RECT()
            _user32.GetClientRect(hwnd, ctypes.byref(rc))
            bg = _gdi32.CreateSolidBrush(_BG)
            _user32.FillRect(hdc, ctypes.byref(rc), bg)
            _gdi32.DeleteObject(bg)
            accent = _gdi32.CreateSolidBrush(_ACCENT)
            b = 3  # border thickness
            for er in (wintypes.RECT(rc.left, rc.top, rc.right, rc.top + b),
                       wintypes.RECT(rc.left, rc.bottom - b, rc.right, rc.bottom),
                       wintypes.RECT(rc.left, rc.top, rc.left + b, rc.bottom),
                       wintypes.RECT(rc.right - b, rc.top, rc.right, rc.bottom)):
                _user32.FillRect(hdc, ctypes.byref(er), accent)
            _gdi32.DeleteObject(accent)
            _gdi32.SetBkMode(hdc, 1)  # TRANSPARENT
            _gdi32.SetTextColor(hdc, _TEXT)
            old_font = _gdi32.SelectObject(hdc, _gdi32.GetStockObject(17))
            pad = wintypes.RECT(rc.left + 14, rc.top + 18,
                                rc.right - 14, rc.bottom - 14)
            _user32.DrawTextW(hdc, _HINT, -1, ctypes.byref(pad),
                              0x0011)  # DT_CENTER | DT_WORDBREAK
            _gdi32.SelectObject(hdc, old_font)
        finally:
            _user32.EndPaint(hwnd, ctypes.byref(ps))

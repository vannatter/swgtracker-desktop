"""In-game resource scanner — hotkey → screen region → native OCR → review queue.

The flow: the user positions a persistent, always-on-top OUTLINE once — either
dragging the outline over the game's Examine window, or dragging the game
window into the outline; both work, it's just "what's inside this rectangle
gets scanned". The geometry persists in config. On Windows the outline is a
native Win32 window (src/core/win_overlay.py) that never takes focus — a
webview one can't do that, and the game minimizes on focus loss; on macOS it
is a small frameless pywebview window. After that, a global hotkey (works while the game has focus) captures
the region, OCRs it with the OS engine (src/core/ocr_engine.py), and appends
the raw lines + a review PNG to an in-memory queue.

Parsing, fuzzy-matching against the resource mirror, and the approve-into-
stockpile UI all live in the bundle (web/js/scanner.js) — deliberately, so OCR
quirks are fixed by bundle deploys, not installer releases. The shell's job
ends at "here are the text lines and the image".

The old standalone scanner (SWGResourceScanner) hardcoded bbox=(14,35,245,250)
— any UI move or resolution change silently broke it. The region here is
user-positioned, visible, and DPI-corrected at capture time.
"""
from __future__ import annotations

import base64
import io
import logging
import threading
import time
from typing import Callable, Optional

from src.core import ocr_engine

logger = logging.getLogger(__name__)

DEFAULT_HOTKEY = "<ctrl>+<shift>+x"
DEFAULT_FRAME_HOTKEY = "<ctrl>+<shift>+a"  # toggles the scan-area overlay
DEFAULT_REGION = {"x": 60, "y": 60, "w": 260, "h": 340}
QUEUE_CAP = 50  # hotkey mashing shouldn't grow memory forever

# The macOS positioning outline (Windows uses the native win_overlay instead).
# Shell-owned HTML (it ships with the shell anyway — create_window is shell
# code). Kept minimal: a border, the "this is the focus area" explanation, and
# the buttons. The whole window IS the region.
_FRAME_HTML = """<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin:0; height:100%; font-family:system-ui,sans-serif; }
  body { box-sizing:border-box; border:3px dashed #e24350; background:rgba(14,16,20,.92);
         color:#cdd3da; display:flex; flex-direction:column; }
  .drag { flex:1; display:flex; flex-direction:column; align-items:center;
          justify-content:center; text-align:center; padding:14px; cursor:move; }
  h1 { font-size:13px; margin:0 0 8px; color:#fff; }
  p { font-size:11.5px; margin:0 0 6px; line-height:1.45; color:#9aa3b2; }
  .btns { display:flex; gap:6px; padding:10px; }
  button { flex:1; padding:7px 0; font-size:12px; cursor:pointer; color:#cdd3da;
           background:#20222f; border:1px solid #2a2f38; border-radius:6px; }
  button:hover { border-color:#e24350; color:#fff; }
  button.primary { background:#e24350; border-color:#e24350; color:#fff; font-weight:600; }
  /* Resize grips. Frameless windows get no native resize borders on Windows
     (FormBorderStyle.None strips them), so the edges/corners are DOM handles
     that drive shell-side resize calls. */
  .grip { position:fixed; z-index:10; }
  .grip[data-edge="n"]  { top:0; left:16px; right:16px; height:7px; cursor:ns-resize; }
  .grip[data-edge="s"]  { bottom:0; left:16px; right:16px; height:7px; cursor:ns-resize; }
  .grip[data-edge="e"]  { right:0; top:16px; bottom:16px; width:7px; cursor:ew-resize; }
  .grip[data-edge="w"]  { left:0; top:16px; bottom:16px; width:7px; cursor:ew-resize; }
  .grip[data-edge="nw"] { top:0; left:0; width:16px; height:16px; cursor:nwse-resize; }
  .grip[data-edge="ne"] { top:0; right:0; width:16px; height:16px; cursor:nesw-resize; }
  .grip[data-edge="sw"] { bottom:0; left:0; width:16px; height:16px; cursor:nesw-resize; }
  .grip[data-edge="se"] { bottom:0; right:0; width:16px; height:16px; cursor:nwse-resize; }
</style></head><body>
  <div class="drag pywebview-drag-region">
    <h1>Scan area</h1>
    <p>Everything inside this outline is what gets scanned.</p>
    <p>Drag this frame over the game's <b>Examine</b> window — or move the game's
       window into it. Drag any edge or corner to resize.</p>
    <p>The fit is saved when you put the outline away — <b>Done</b> or the
       overlay hotkey. <b>Test scan</b> captures right now so you can check it.</p>
  </div>
  <div class="btns">
    <button onclick="pywebview.api.frame_test()">Test scan</button>
    <button class="primary" onclick="pywebview.api.frame_save()">Done</button>
  </div>
  <div class="grip" data-edge="n"></div><div class="grip" data-edge="s"></div>
  <div class="grip" data-edge="e"></div><div class="grip" data-edge="w"></div>
  <div class="grip" data-edge="nw"></div><div class="grip" data-edge="ne"></div>
  <div class="grip" data-edge="sw"></div><div class="grip" data-edge="se"></div>
  <script>
  // Edge/corner resize. Total pointer deltas go to the shell, which resizes
  // with the opposite edge pinned. One bridge call in flight at a time and
  // only the latest delta is kept, so a fast drag never queues stale steps.
  (function () {
    var armed = false, inflight = false, pending = null;
    function push(edge, dx, dy) {
      pending = [edge, dx, dy];
      if (inflight || !armed) return;
      var p = pending; pending = null; inflight = true;
      pywebview.api.frame_grip(p[0], p[1], p[2]).catch(function () {}).then(function () {
        inflight = false;
        if (pending !== null) { var q = pending; pending = null; push(q[0], q[1], q[2]); }
      });
    }
    document.querySelectorAll('.grip').forEach(function (g) {
      g.addEventListener('pointerdown', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        g.setPointerCapture(ev.pointerId);
        armed = false;
        var sx = ev.screenX, sy = ev.screenY, edge = g.dataset.edge;
        pywebview.api.frame_grip_begin().then(function () { armed = true; });
        function mv(e) { push(edge, e.screenX - sx, e.screenY - sy); }
        function up() {
          armed = false;
          g.removeEventListener('pointermove', mv);
          g.removeEventListener('pointerup', up);
        }
        g.addEventListener('pointermove', mv);
        g.addEventListener('pointerup', up);
      });
    });
  })();
  </script>
</body></html>"""


# Success-sound choices (scan_sound config; dev-only picker in Settings).
# Values are (macOS system sound, Windows media wav) — both OSes ship these,
# so we bundle nothing. Failure is fixed: Basso / SystemHand reads as "error".
SCAN_SOUNDS = {
    "ping":  ("/System/Library/Sounds/Ping.aiff",  r"C:\Windows\Media\Windows Ding.wav"),
    "glass": ("/System/Library/Sounds/Glass.aiff", r"C:\Windows\Media\chimes.wav"),
    "hero":  ("/System/Library/Sounds/Hero.aiff",  r"C:\Windows\Media\tada.wav"),
}
DEFAULT_SOUND = "ping"


def _windows_dpi_scale() -> float:
    """Logical→physical pixel factor for the primary display (1.25 at 125%).
    GetDpiForSystem needs Win10 1607+; older machines fall back to GDI."""
    import ctypes
    user32 = ctypes.windll.user32
    try:
        return user32.GetDpiForSystem() / 96.0
    except Exception:  # noqa: BLE001
        try:
            dc = user32.GetDC(0)
            try:
                return ctypes.windll.gdi32.GetDeviceCaps(dc, 88) / 96.0  # LOGPIXELSX
            finally:
                user32.ReleaseDC(0, dc)
        except Exception:  # noqa: BLE001
            return 1.0


def _win_rect_visible(r: dict) -> bool:
    """Does this physical rect meaningfully overlap the virtual desktop?
    Guards against a region committed while the outline was minimized or
    dragged off-screen — restoring THAT would make the outline invisible
    forever with no error anywhere."""
    import ctypes
    u = ctypes.windll.user32
    vx, vy = u.GetSystemMetrics(76), u.GetSystemMetrics(77)   # SM_X/YVIRTUALSCREEN
    vw, vh = u.GetSystemMetrics(78), u.GetSystemMetrics(79)   # SM_CX/CYVIRTUALSCREEN
    return (r["x"] + r["w"] > vx + 20 and r["x"] < vx + vw - 20 and
            r["y"] + r["h"] > vy + 20 and r["y"] < vy + vh - 20)


def _play_sound(name: str, fail: bool = False) -> None:
    """Capture feedback the user can hear IN GAME — with the game focused,
    sounds land where notifications don't. Zero new deps: winsound is stdlib,
    afplay ships with macOS. Async / fire-and-forget; failure to play is fine.
    """
    try:
        import sys
        if sys.platform == "win32":
            import os
            import winsound
            if fail:
                winsound.PlaySound("SystemHand", winsound.SND_ALIAS | winsound.SND_ASYNC)
                return
            wav = SCAN_SOUNDS.get(name, SCAN_SOUNDS[DEFAULT_SOUND])[1]
            if os.path.exists(wav):
                winsound.PlaySound(wav, winsound.SND_FILENAME | winsound.SND_ASYNC)
            else:  # media wav missing on some installs — any ding beats silence
                winsound.PlaySound("SystemAsterisk", winsound.SND_ALIAS | winsound.SND_ASYNC)
        elif sys.platform == "darwin":
            import subprocess
            snd = "/System/Library/Sounds/Basso.aiff" if fail \
                else SCAN_SOUNDS.get(name, SCAN_SOUNDS[DEFAULT_SOUND])[0]
            subprocess.Popen(["afplay", snd],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:  # noqa: BLE001 — feedback only, never fail a scan over it
        pass


# macOS global hotkey. pynput is unusable here (see start_hotkey), so we go
# straight to Carbon's RegisterEventHotKey via ctypes (pyobjc doesn't wrap
# Carbon). Picked over a CGEventTap because it needs NO permission — the OS
# hands us only our registered combo, never a keystroke stream, so CrossOver
# players don't face an Input Monitoring prompt on top of Screen Recording.
# Events arrive through the NSApp run loop pywebview is already running.

_MAC_KEYCODES = {  # ANSI virtual keycodes (HIToolbox/Events.h)
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8,
    "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
    "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26,
    "8": 28, "0": 29, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38,
    "k": 40, "n": 45, "m": 46,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98,
    "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
}
_MAC_MODIFIERS = {"cmd": 0x0100, "shift": 0x0200, "alt": 0x0800, "ctrl": 0x1000}


class _MacHotKeys:
    """Carbon-registered global hotkeys, shaped like pynput.GlobalHotKeys:
    {combo: callback}. start() arms them all, stop() disarms."""

    def __init__(self, hotkeys: dict):
        self._hotkeys = dict(hotkeys)
        self._carbon = None
        self._handler_cb = None  # keeps the CFUNCTYPE alive — GC'd = segfault
        self._handler_ref = None
        self._hotkey_refs: list = []
        self._by_id: dict = {}  # registered hotkey id -> callback
        self._down: set = set()  # ids held down: swallow key-repeat events

    @staticmethod
    def parse(combo: str):
        """pynput-style '<ctrl>+<shift>+x' → (keycode, carbon mods), or None."""
        mods, key = 0, None
        for tok in combo.lower().split("+"):
            tok = tok.strip().strip("<>")
            if tok in _MAC_MODIFIERS:
                mods |= _MAC_MODIFIERS[tok]
            elif tok in _MAC_KEYCODES and key is None:
                key = _MAC_KEYCODES[tok]
            else:
                return None
        return (key, mods) if key is not None else None

    @staticmethod
    def _run_on_main(fn):
        """Carbon isn't thread-safe; js_api calls arrive on worker threads.
        Boot-time calls are already on the main thread and run directly."""
        if threading.current_thread() is threading.main_thread():
            return fn()
        result: list = []
        done = threading.Event()

        def _wrap():
            try:
                result.append(fn())
            finally:
                done.set()
        from PyObjCTools import AppHelper
        AppHelper.callAfter(_wrap)
        done.wait(3.0)
        return result[0] if result else None

    def start(self) -> bool:
        combos = []
        for combo, cb in self._hotkeys.items():
            parsed = self.parse(combo)
            if parsed is None:
                logger.error("scanner hotkey: can't map %r to a macOS key", combo)
                continue
            combos.append((parsed, cb))
        if not combos:
            return False
        try:
            return bool(self._run_on_main(lambda: self._register(combos)))
        except Exception:  # noqa: BLE001
            logger.error("scanner hotkey (carbon) failed", exc_info=True)
            return False

    def _register(self, combos: list) -> bool:
        import ctypes
        carbon = ctypes.CDLL("/System/Library/Frameworks/Carbon.framework/Carbon")

        class _EventTypeSpec(ctypes.Structure):
            _fields_ = [("eventClass", ctypes.c_uint32), ("eventKind", ctypes.c_uint32)]

        class _EventHotKeyID(ctypes.Structure):
            _fields_ = [("signature", ctypes.c_uint32), ("id", ctypes.c_uint32)]

        _HANDLER = ctypes.CFUNCTYPE(ctypes.c_int32, ctypes.c_void_p,
                                    ctypes.c_void_p, ctypes.c_void_p)

        carbon.GetEventKind.argtypes = [ctypes.c_void_p]
        carbon.GetEventKind.restype = ctypes.c_uint32
        # GetEventParameter(event, name, type, outType, bufSize, outSize, outData)
        carbon.GetEventParameter.argtypes = [
            ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
            ctypes.c_ulong, ctypes.c_void_p, ctypes.c_void_p]

        def _fired(_call_ref, event, _user_data):
            # Which of our hotkeys was it? ('----' direct object, 'hkid' type)
            hkid = _EventHotKeyID()
            carbon.GetEventParameter(event, 0x2D2D2D2D, 0x686B6964, None,
                                     ctypes.sizeof(hkid), None, ctypes.byref(hkid))
            # Holding a combo makes macOS auto-repeat Pressed events (one
            # scan per repeat tick!) — fire only on the first press of a hold.
            kind = carbon.GetEventKind(event)
            if kind == 6:  # kEventHotKeyReleased — rearm
                self._down.discard(hkid.id)
            elif hkid.id not in self._down:
                self._down.add(hkid.id)
                cb = self._by_id.get(hkid.id)
                try:
                    if cb:
                        cb()  # spawns a thread; keep the run loop snappy
                except Exception:  # noqa: BLE001
                    logger.error("scanner hotkey callback failed", exc_info=True)
            return 0  # noErr

        carbon.GetEventDispatcherTarget.restype = ctypes.c_void_p
        target = carbon.GetEventDispatcherTarget()

        self._handler_cb = _HANDLER(_fired)
        specs = (_EventTypeSpec * 2)(  # kEventClassKeyboard: pressed, released
            _EventTypeSpec(0x6B657962, 5), _EventTypeSpec(0x6B657962, 6))
        handler_ref = ctypes.c_void_p()
        carbon.InstallEventHandler.argtypes = [
            ctypes.c_void_p, _HANDLER, ctypes.c_ulong,
            ctypes.POINTER(_EventTypeSpec), ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_void_p)]
        if carbon.InstallEventHandler(target, self._handler_cb, 2,
                                      specs, None,
                                      ctypes.byref(handler_ref)) != 0:
            return False
        self._handler_ref = handler_ref
        self._carbon = carbon

        carbon.RegisterEventHotKey.argtypes = [
            ctypes.c_uint32, ctypes.c_uint32, _EventHotKeyID,
            ctypes.c_void_p, ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)]
        for i, ((keycode, modifiers), cb) in enumerate(combos, start=1):
            hotkey_ref = ctypes.c_void_p()
            hkid = _EventHotKeyID(0x73776774, i)  # 'swgt'
            if carbon.RegisterEventHotKey(keycode, modifiers, hkid, target, 0,
                                          ctypes.byref(hotkey_ref)) != 0:
                logger.error("scanner hotkey: RegisterEventHotKey refused id %d", i)
                continue
            self._hotkey_refs.append(hotkey_ref)
            self._by_id[i] = cb
        if not self._by_id:
            self._unregister()
            return False
        return True

    def _unregister(self) -> None:
        c = self._carbon
        try:
            for ref in self._hotkey_refs:
                c.UnregisterEventHotKey(ref)
            if c is not None and self._handler_ref:
                c.RemoveEventHandler(self._handler_ref)
        except Exception:  # noqa: BLE001
            pass
        self._hotkey_refs = []
        self._by_id = {}
        self._handler_ref = self._handler_cb = None

    def stop(self) -> None:
        try:
            self._run_on_main(self._unregister)
        except Exception:  # noqa: BLE001 — shutdown path: loop may be gone
            pass


class _FrameApi:
    """js_api for the outline window — thin calls back into the Scanner."""

    def __init__(self, scanner: "Scanner"):
        self._s = scanner
        self._grip_size = None  # (w, h) at resize-drag start

    def frame_save(self):
        self._s.hide_frame()  # hiding commits the position

    def frame_test(self):
        # Commit first so the test scans exactly what dismissing would keep.
        self._s._frame_commit()
        threading.Thread(target=self._s.capture_and_queue, daemon=True).start()

    def frame_close(self):
        self._s.hide_frame()

    def frame_grip_begin(self):
        w = self._s._frame
        if w is not None:
            self._grip_size = (w.width, w.height)

    def frame_grip(self, edge, dx, dy):
        """One resize step: dx/dy are the TOTAL pointer delta since
        frame_grip_begin, applied to the starting size with the opposite
        edge/corner pinned — no drift from accumulating increments."""
        w = self._s._frame
        if w is None or self._grip_size is None:
            return
        from webview.window import FixPoint
        edge, dx, dy = str(edge), int(dx), int(dy)
        w0, h0 = self._grip_size
        nw = w0 - dx if "w" in edge else w0 + dx if "e" in edge else w0
        nh = h0 - dy if "n" in edge else h0 + dy if "s" in edge else h0
        fix = (FixPoint.EAST if "w" in edge else FixPoint.WEST) | \
              (FixPoint.SOUTH if "n" in edge else FixPoint.NORTH)
        try:
            w.resize(max(180, nw), max(140, nh), fix)
        except Exception:  # noqa: BLE001 — a single resize step is best-effort
            pass


class Scanner:
    def __init__(self, config, notify: Optional[Callable[[str, str], None]] = None,
                 on_queue_change: Optional[Callable[[], None]] = None):
        self.config = config
        self.notify = notify or (lambda title, msg: None)
        self.on_queue_change = on_queue_change or (lambda: None)
        self.queue: list[dict] = []
        self._qlock = threading.Lock()
        self._next_id = 1
        self._listener = None
        self._frame = None    # macOS pywebview outline
        self._overlay = None  # Windows native outline (win_overlay.Overlay)

    # ------------------------------------------------------------ config

    def get_region(self) -> dict:
        r = self.config.get("scan_region")
        return r if isinstance(r, dict) and all(k in r for k in "xywh") else dict(DEFAULT_REGION)

    def set_region(self, x: int, y: int, w: int, h: int) -> None:
        self.config.set("scan_region", {"x": int(x), "y": int(y),
                                        "w": max(60, int(w)), "h": max(60, int(h))})
        import sys
        if sys.platform == "win32":
            # capture reads the PHYSICAL rect on Windows — keep it in sync when
            # the region is set from logical coords (the webview fallback frame)
            s = _windows_dpi_scale()
            self.config.set("scan_region_px", {
                "x": round(x * s), "y": round(y * s),
                "w": max(60, round(w * s)), "h": max(60, round(h * s))})
        self.config.save()

    def get_region_px(self) -> dict:
        """Windows: the region in EXACT physical pixels. The native overlay is
        created from this rect and commits back to it verbatim, and capture
        crops it directly — no logical/physical conversion anywhere to drift
        (the old logical round-trip truncated a pixel per open/close)."""
        r = self.config.get("scan_region_px")
        if isinstance(r, dict) and all(k in r for k in "xywh"):
            r = {k: int(r[k]) for k in "xywh"}
            if _win_rect_visible(r):
                return r
            logger.warning("scan region %s is off-screen — resetting to default", r)
        s = _windows_dpi_scale()  # first run / bad rect / pre-px config
        r = self.get_region()
        r = {"x": int(r["x"] * s), "y": int(r["y"] * s),
             "w": int(r["w"] * s), "h": int(r["h"] * s)}
        if not _win_rect_visible(r):  # legacy logical rect can be junk too
            r = {"x": int(DEFAULT_REGION["x"] * s), "y": int(DEFAULT_REGION["y"] * s),
                 "w": int(DEFAULT_REGION["w"] * s), "h": int(DEFAULT_REGION["h"] * s)}
        return r

    def set_region_px(self, x: int, y: int, w: int, h: int) -> None:
        r = {"x": int(x), "y": int(y), "w": max(60, int(w)), "h": max(60, int(h))}
        if not _win_rect_visible(r):
            logger.warning("refusing to save off-screen scan region %s", r)
            return
        self.config.set("scan_region_px", r)
        s = _windows_dpi_scale() or 1.0
        # keep the legacy logical mirror in rough sync (older shells read it)
        self.config.set("scan_region", {"x": round(x / s), "y": round(y / s),
                                        "w": max(60, round(w / s)),
                                        "h": max(60, round(h / s))})
        self.config.save()

    def get_hotkey(self) -> str:
        return str(self.config.get("scan_hotkey") or DEFAULT_HOTKEY)

    def get_frame_hotkey(self) -> str:
        return str(self.config.get("scan_frame_hotkey") or DEFAULT_FRAME_HOTKEY)

    def get_sound(self) -> str:
        s = str(self.config.get("scan_sound") or DEFAULT_SOUND)
        return s if s in SCAN_SOUNDS else DEFAULT_SOUND

    def sound_enabled(self) -> bool:
        return bool(self.config.get("scan_sound_enabled", True))

    def _play(self, success: bool) -> None:
        if self.sound_enabled():
            _play_sound(self.get_sound(), fail=not success)

    def enabled(self) -> bool:
        return bool(self.config.get("scan_enabled", False)) and ocr_engine.available()

    # ------------------------------------------------------------ hotkey

    def start_hotkey(self) -> bool:
        """(Re)arm the global hotkeys — scan capture + scan-area overlay
        toggle. Returns whether a listener is running."""
        self.stop_hotkey()
        if not self.enabled():
            return False
        import sys
        combo = self.get_hotkey()
        hotkeys = {combo: self._on_hotkey}
        frame_combo = self.get_frame_hotkey()
        if frame_combo == combo:
            logger.warning("scanner: overlay hotkey %s collides with the scan "
                           "hotkey — overlay toggle not armed", frame_combo)
        else:
            hotkeys[frame_combo] = self._on_frame_hotkey
        if sys.platform == "darwin":
            # pynput SIGTRAPs here — its darwin backend builds a keymap via
            # TSMGetInputSourceProperty, which macOS traps off the main queue,
            # and WKWebView owns our main loop (verified from a live crash
            # report). Carbon RegisterEventHotKey instead: CrossOver players
            # get the same in-game hotkey as Windows, with no extra permission.
            hk = _MacHotKeys(hotkeys)
            if hk.start():
                self._listener = hk
                logger.info("scanner hotkeys armed (carbon): %s", ", ".join(hotkeys))
                return True
            logger.error("scanner hotkey failed to arm on macOS (combo=%s)", combo)
            return False
        try:
            from pynput import keyboard
            self._listener = keyboard.GlobalHotKeys(hotkeys)
            self._listener.daemon = True
            self._listener.start()
            logger.info("scanner hotkeys armed: %s", ", ".join(hotkeys))
            return True
        except Exception:  # noqa: BLE001 — bad combo string, no perms, etc.
            logger.error("scanner hotkey failed to arm (combo=%s)", combo, exc_info=True)
            self._listener = None
            return False

    def stop_hotkey(self) -> None:
        if self._listener is not None:
            try:
                self._listener.stop()
            except Exception:  # noqa: BLE001
                pass
            self._listener = None

    def _on_hotkey(self):
        # Called on pynput's listener thread (win) or the main run loop (mac) —
        # do the work on a fresh thread so a slow OCR never wedges either.
        threading.Thread(target=self.capture_and_queue, daemon=True).start()

    def _on_frame_hotkey(self):
        threading.Thread(target=self.toggle_frame, daemon=True).start()

    # ------------------------------------------------------------ capture

    def _macos_capture_access(self) -> bool:
        """Check + REQUEST macOS Screen Recording permission. The request makes
        the OS show its own prompt / deep-link into System Settings with the
        right app attribution — far better than sending the user hunting."""
        try:
            import Quartz
            if Quartz.CGPreflightScreenCaptureAccess():
                return True
            Quartz.CGRequestScreenCaptureAccess()  # OS prompt, first time only
            return Quartz.CGPreflightScreenCaptureAccess()
        except Exception:  # noqa: BLE001 — older macOS / missing API: just try
            return True

    def capture(self):
        """Grab the saved region → PIL image, or None.

        Windows: region and grab are both physical pixels — direct crop.
        macOS: region is logical points; physical grab width ÷ logical screen
        width gives the retina factor. Primary display only for now.
        """
        try:
            import sys
            if sys.platform == "darwin" and not self._macos_capture_access():
                return None  # capture_and_queue explains + the OS prompt is up
            import webview
            from PIL import ImageGrab
            shot = ImageGrab.grab()
            if sys.platform == "win32":
                # The grab is physical px and so is the stored region — the
                # native overlay commits its exact window rect. Crop verbatim.
                r = self.get_region_px()
                box = (r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])
            else:
                logical_w = webview.screens[0].width if webview.screens else shot.width
                scale = shot.width / max(1, logical_w)
                r = self.get_region()
                box = (int(r["x"] * scale), int(r["y"] * scale),
                       int((r["x"] + r["w"]) * scale), int((r["y"] + r["h"]) * scale))
            box = (max(0, box[0]), max(0, box[1]),
                   min(shot.width, box[2]), min(shot.height, box[3]))
            if box[2] - box[0] < 20 or box[3] - box[1] < 20:
                return None
            return shot.crop(box)
        except Exception:  # noqa: BLE001
            logger.error("scan capture failed", exc_info=True)
            return None

    def capture_and_queue(self) -> Optional[dict]:
        """Hotkey path: capture → OCR → queue. Returns the queue item."""
        was_visible = self.frame_visible()
        if was_visible:
            self.hide_frame()  # commits the outline's position as the region
            time.sleep(0.25)  # let the compositor actually remove it
        image = self.capture()
        if was_visible:
            self.show_frame()  # bring the outline back — the user was mid-fit
        if image is None:
            self._play(False)
            import sys
            if sys.platform == "darwin":
                # On a Mac this is nearly always the Screen Recording permission:
                # ImageGrab's screencapture writes an unreadable file without it.
                self.notify("Scan failed", "macOS is blocking screen capture — allow it in "
                            "System Settings → Privacy & Security → Screen Recording, then relaunch.")
            else:
                self.notify("Scan failed", "Couldn't capture the scan area.")
            return None
        lines, alt_lines = ocr_engine.read_text_dual(image)
        if not lines:
            self._play(False)
            self.notify("Scan failed", "No text found in the scan area — "
                                       "is the Examine window inside the outline?")
            return None

        buf = io.BytesIO()
        image.save(buf, format="PNG")
        with self._qlock:
            item = {
                "id": self._next_id,
                "ts": int(time.time()),
                "lines": lines,
                # second OCR pass (different preprocessing) — the UI reconciles
                # the two readings; absent on machines where the pass failed
                "alt_lines": alt_lines,
                "image": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
            }
            self._next_id += 1
            self.queue.append(item)
            del self.queue[:-QUEUE_CAP]
        # Success is SOUND-ONLY: the batch flow is scanning 15-20 crates in a
        # row heads-down in game — a notification per capture would be spam.
        # Failures notify (above) because those need the user's eyes.
        self._play(True)
        self.on_queue_change()
        return item

    # ------------------------------------------------------------ queue

    def queue_list(self) -> list[dict]:
        with self._qlock:
            return list(self.queue)

    def queue_remove(self, item_id: int) -> None:
        with self._qlock:
            self.queue = [q for q in self.queue if q["id"] != int(item_id)]

    # ------------------------------------------------------------ frame

    def frame_visible(self) -> bool:
        o = self._overlay
        return (o is not None and o.visible) or self._frame is not None

    def show_frame(self) -> None:
        """Show the positioning outline at the saved region.

        Windows gets a NATIVE overlay (src/core/win_overlay.py), not a
        pywebview window: WebView2 steals focus on any click no matter the
        window styles, and the game minimizes the moment it loses focus. The
        native window never activates anything and stores exact physical px.
        macOS keeps the pywebview outline — Cocoa has no such problem."""
        import sys
        if sys.platform == "win32":
            if self._overlay is not None and self._overlay.visible:
                return
            err = None
            try:
                from src.core import win_overlay
                r = self.get_region_px()
                o = win_overlay.Overlay(
                    (r["x"], r["y"], r["w"], r["h"]),
                    lambda rect: self.set_region_px(*rect))
                self._overlay = o
                o.show()
                if o.wait_shown(2.0):
                    return
                err = o.error or "timed out without appearing"
                o.close()  # a late-arriving window must not linger as an orphan
                self._overlay = None
            except Exception as e:  # noqa: BLE001 — incl. module missing from a frozen build
                err = repr(e)
            # A dead button is the worst outcome — say so and show the webview
            # frame instead (it works, it just takes focus when clicked).
            logger.error("native scan overlay unavailable (%s) — webview fallback", err)
            self.notify("Scan area", "The native overlay failed to open — using the "
                        "basic frame instead. Please report this!")
        if self._frame is not None:
            return
        import webview
        r = self.get_region()
        self._frame = webview.create_window(
            "Scan area", html=_FRAME_HTML, js_api=_FrameApi(self),
            x=r["x"], y=r["y"], width=r["w"], height=r["h"],
            frameless=True, on_top=True, easy_drag=False,
            min_size=(180, 140), background_color="#0e1014")

    def toggle_frame(self) -> None:
        """Overlay hotkey: show the positioning outline, or put it away."""
        if self.frame_visible():
            self.hide_frame()
        else:
            self.show_frame()

    def hide_frame(self) -> None:
        """Put the outline away, KEEPING its position — wherever the user left
        the outline is the region they meant, however it gets dismissed
        (Done, overlay hotkey, or a scan hotkey press mid-positioning)."""
        o, self._overlay = self._overlay, None
        if o is not None:
            o.close()  # WM_CLOSE commits the exact physical rect before dying
        w, self._frame = self._frame, None
        if w is None:
            return
        try:
            self.set_region(w.x, w.y, w.width, w.height)
        except Exception:  # noqa: BLE001 — geometry read can fail mid-teardown
            logger.error("saving scan region on hide failed", exc_info=True)
        try:
            w.destroy()
        except Exception:  # noqa: BLE001
            pass

    def _frame_commit(self) -> None:
        w = self._frame
        if w is None:
            return
        try:
            self.set_region(w.x, w.y, w.width, w.height)
        except Exception:  # noqa: BLE001
            logger.error("saving scan region failed", exc_info=True)

    def shutdown(self) -> None:
        self.stop_hotkey()
        self.hide_frame()

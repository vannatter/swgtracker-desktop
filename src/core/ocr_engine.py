"""OS-native OCR behind one function — no bundled engine.

The in-game scanner needs to read the SWG examine window. The old standalone
scanner used pytesseract, which requires a separately-installed Tesseract binary
(a config'd absolute path) — a non-starter for a shipped installer. Both OSes we
run on ship an OCR engine of their own, so we use those and bundle nothing:

  * Windows  — Windows.Media.Ocr (Windows 10+), via the `winsdk` package.
               This is the platform the game actually runs on.
  * macOS    — Apple Vision (VNRecognizeTextRequest), via pyobjc. Dev/test path.

read_text() returns plain line dicts ordered top-to-bottom. All parsing and
matching deliberately lives in the UI bundle (see web/js/scanner.js): OCR quirks
get tuned per-bundle-deploy, not per-installer-release, so the shell surface
here stays dumb and stable.

Engines are lazy-initialized on first use and failures degrade to
available() == False rather than raising at import time — the app must boot
fine on a machine with no OCR (or with winsdk missing) with the feature simply
absent.
"""
from __future__ import annotations

import io
import logging
import sys
from typing import Optional

logger = logging.getLogger(__name__)

# Small game fonts OCR poorly at native size; both engines do markedly better
# with a modest upscale. 3x LANCZOS on a ~230px-wide examine crop is cheap.
_UPSCALE = 3
_MAX_SIDE = 2400  # don't explode a large region into a huge bitmap


def _prepare(image):
    """Upscale a (small) capture for the engine. PIL in, PIL out."""
    w, h = image.size
    scale = min(_UPSCALE, max(1, _MAX_SIDE // max(w, h, 1)))
    if scale > 1:
        from PIL import Image
        image = image.resize((w * scale, h * scale), Image.LANCZOS)
    return image.convert("RGB")


# ---------------------------------------------------------------- macOS

def _read_text_macos(image) -> list[dict]:
    import Vision
    from Foundation import NSData

    buf = io.BytesIO()
    _prepare(image).save(buf, format="PNG")
    data = NSData.dataWithBytes_length_(buf.getvalue(), len(buf.getvalue()))

    handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(data, None)
    request = Vision.VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    # No language correction: resource names ("Fopidansis") aren't words, and
    # correction would happily turn them into ones.
    request.setUsesLanguageCorrection_(False)

    ok = handler.performRequests_error_([request], None)
    if not ok:
        return []
    lines = []
    for obs in (request.results() or []):
        cand = obs.topCandidates_(1)
        if not cand or not len(cand):
            continue
        box = obs.boundingBox()  # normalized, origin bottom-left
        lines.append({
            "text": str(cand[0].string()),
            "conf": float(cand[0].confidence()),
            "y": 1.0 - float(box.origin.y),  # flip so smaller = higher on screen
        })
    lines.sort(key=lambda l: l["y"])
    return [{"text": l["text"], "conf": l["conf"]} for l in lines]


# ---------------------------------------------------------------- Windows

def _read_text_windows(image) -> list[dict]:
    import asyncio

    from winsdk.windows.graphics.imaging import (BitmapPixelFormat,
                                                 SoftwareBitmap)
    from winsdk.windows.media.ocr import OcrEngine
    from winsdk.windows.security.cryptography import CryptographicBuffer

    prepared = _prepare(image).convert("RGBA")
    w, h = prepared.size
    ibuf = CryptographicBuffer.create_from_byte_array(bytearray(prepared.tobytes()))
    bitmap = SoftwareBitmap.create_copy_from_buffer(ibuf, BitmapPixelFormat.RGBA8, w, h)

    engine = OcrEngine.try_create_from_user_profile_languages()
    if engine is None:
        # No OCR language pack installed for the user's profile language.
        logger.warning("Windows OCR: no engine for the user profile languages")
        return []

    async def _run():
        return await engine.recognize_async(bitmap)

    result = asyncio.run(_run())
    lines = []
    for line in result.lines:
        words = list(line.words)
        # order by the line's top edge so multi-column noise doesn't interleave
        top = min((wd.bounding_rect.y for wd in words), default=0)
        lines.append({"text": str(line.text), "conf": None, "y": top})
    lines.sort(key=lambda l: l["y"])
    return [{"text": l["text"], "conf": l["conf"]} for l in lines]


# ---------------------------------------------------------------- public

_available: Optional[bool] = None


def available() -> bool:
    """Can this machine OCR at all? Probed once, cached."""
    global _available
    if _available is None:
        try:
            if sys.platform == "darwin":
                import Vision  # noqa: F401
                _available = True
            elif sys.platform == "win32":
                from winsdk.windows.media.ocr import OcrEngine
                _available = OcrEngine.try_create_from_user_profile_languages() is not None
            else:
                _available = False
        except Exception:  # noqa: BLE001 — any import/probe failure = no OCR
            logger.info("native OCR unavailable", exc_info=True)
            _available = False
    return _available


def read_text(image) -> list[dict]:
    """OCR a PIL image → [{"text": str, "conf": float|None}], top-to-bottom.

    Never raises: an engine failure returns [] and logs, so a hotkey press on a
    bad frame can't take the shell down.
    """
    if not available():
        return []
    try:
        if sys.platform == "darwin":
            return _read_text_macos(image)
        if sys.platform == "win32":
            return _read_text_windows(image)
        return []
    except Exception:  # noqa: BLE001
        logger.error("OCR failed", exc_info=True)
        return []

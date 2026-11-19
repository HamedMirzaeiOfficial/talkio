"""Attachment content inspection.

The client-declared content type is never trusted. The type is derived from the file's
leading bytes; only types in ``CHAT_ALLOWED_ATTACHMENT_TYPES`` are accepted. Active
content (SVG, HTML, scripts) is never detected and therefore never accepted.
"""

from __future__ import annotations

import os
import re
import unicodedata

HEADER_BYTES = 64


def detect_content_type(head: bytes, declared: str | None = None, name: str = "") -> str | None:
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "audio/wav"
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    if head.startswith(b"OggS"):
        return "audio/ogg"
    if head.startswith(b"ID3") or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio/mpeg"
    # WebM and MP4 are containers for audio-only and video. Browsers record voice notes as
    # audio/webm (Chrome/Firefox) or audio/mp4 (Safari); the declared type only chooses
    # between the audio and video variant of a container that was positively identified.
    audio = (declared or "").startswith("audio/")
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm" if audio else "video/webm"
    if head[4:8] == b"ftyp":
        return "audio/mp4" if audio or head[8:12] in (b"M4A ", b"M4B ") else "video/mp4"
    return None


def looks_like_text(data: bytes) -> bool:
    if b"\x00" in data:
        return False
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        # The sample may cut a multi-byte sequence; retry without the last 3 bytes.
        try:
            data[:-3].decode("utf-8")
        except UnicodeDecodeError:
            return False
    lowered = data[:512].lstrip().lower()
    return not lowered.startswith((b"<!doctype", b"<html", b"<svg", b"<?xml", b"<script"))


def sniff_upload(upload) -> str | None:
    upload.seek(0)
    head = upload.read(HEADER_BYTES)
    detected = detect_content_type(head, getattr(upload, "content_type", None))
    if detected is None:
        upload.seek(0)
        sample = upload.read(8192)
        ext = os.path.splitext(upload.name or "")[1].lower()
        if ext in {".txt", ".log", ".md", ".csv", ""} and looks_like_text(sample):
            detected = "text/plain"
    upload.seek(0)
    return detected


_UNSAFE_NAME = re.compile(r"[^\w.\- ()\[\]]+", re.UNICODE)


def safe_filename(name: str, max_length: int = 200) -> str:
    """Display name only (storage paths use random names)."""
    base = os.path.basename((name or "").replace("\\", "/"))
    base = unicodedata.normalize("NFC", base)
    base = "".join(ch for ch in base if unicodedata.category(ch)[0] != "C")
    base = _UNSAFE_NAME.sub("_", base).strip(" .") or "file"
    if len(base) > max_length:
        stem, ext = os.path.splitext(base)
        base = stem[: max_length - len(ext)] + ext
    return base


def make_thumbnail(upload, max_side: int):
    """A WebP preview for large still images, or None (small, animated, or no Pillow)."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return None
    import io

    from django.core.files.base import ContentFile

    upload.seek(0)
    try:
        with Image.open(upload) as image:
            if getattr(image, "is_animated", False) or max(image.size) <= max_side:
                return None
            image = ImageOps.exif_transpose(image)
            image.thumbnail((max_side, max_side))
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if "transparency" in image.info else "RGB")
            buffer = io.BytesIO()
            image.save(buffer, format="WEBP", quality=80, method=4)
    except Exception:
        return None
    finally:
        upload.seek(0)
    return ContentFile(buffer.getvalue(), name="thumb.webp")


def image_dimensions(upload) -> tuple[int | None, int | None]:
    try:
        from PIL import Image
    except ImportError:  # Pillow is optional
        return None, None
    try:
        upload.seek(0)
        with Image.open(upload) as image:
            image.verify()
            width, height = image.size
    except Exception as exc:
        raise ValueError("The file is not a valid image.") from exc
    finally:
        upload.seek(0)
    if width * height > 80_000_000:  # decompression-bomb guard
        raise ValueError("The image is too large.")
    return width, height

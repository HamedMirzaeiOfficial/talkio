"""Sticker packs curated by staff."""

from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError

from ..conf import chat_settings
from ..errors import FeatureDisabled, NotFound, ValidationFailed
from ..files import detect_content_type, image_dimensions
from ..models import Sticker, StickerPack

STICKER_TYPES = {"image/png", "image/webp", "image/gif"}
MAX_STICKER_SIDE = 512


def list_packs() -> list[StickerPack]:
    if not chat_settings.ENABLE_STICKERS:
        return []
    return list(StickerPack.objects.filter(is_active=True).prefetch_related("stickers"))


def resolve_sticker(sticker_id: Any) -> Sticker:
    """A sticker that may be sent now (its pack must be active)."""
    if not chat_settings.ENABLE_STICKERS:
        raise FeatureDisabled("Stickers are disabled.")
    try:
        return Sticker.objects.select_related("pack").get(pk=sticker_id, pack__is_active=True)
    except (Sticker.DoesNotExist, ValueError, DjangoValidationError) as exc:
        raise ValidationFailed("Unknown sticker.", code="invalid_sticker") from exc


def get_sticker(sticker_id: Any) -> Sticker:
    """Any existing sticker (old messages keep rendering after a pack is retired)."""
    try:
        return Sticker.objects.get(pk=sticker_id)
    except (Sticker.DoesNotExist, ValueError, DjangoValidationError) as exc:
        raise NotFound("Sticker not found.") from exc


def inspect_sticker_file(upload: Any) -> tuple[str, int | None, int | None]:
    """Validate an uploaded sticker image; returns (content_type, width, height)."""
    if upload.size > chat_settings.MAX_STICKER_SIZE:
        raise ValidationFailed("Sticker files must be at most 512 KB.", code="file_too_large")
    upload.seek(0)
    content_type = detect_content_type(upload.read(64))
    upload.seek(0)
    if content_type not in STICKER_TYPES:
        raise ValidationFailed("Stickers must be PNG, WebP or GIF images.", code="unsupported_file_type")
    try:
        width, height = image_dimensions(upload)
    except ValueError as exc:
        raise ValidationFailed(str(exc), code="invalid_image") from exc
    if width and height and max(width, height) > MAX_STICKER_SIDE:
        raise ValidationFailed("Stickers must be at most 512×512 pixels.", code="invalid_image")
    return content_type, width, height

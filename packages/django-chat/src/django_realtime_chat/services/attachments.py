"""Attachment upload, access control and cleanup."""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from ..conf import chat_settings
from ..errors import FeatureDisabled, NotFound, PermissionDenied, ValidationFailed
from ..files import image_dimensions, make_thumbnail, safe_filename, sniff_upload
from ..models import Attachment
from .conversations import get_membership

PENDING_WINDOW = timedelta(hours=24)
MAX_WAVEFORM_BARS = 128


def _voice_metadata(duration: Any, waveform: Any) -> tuple[float, list[int]]:
    if not chat_settings.ENABLE_VOICE:
        raise FeatureDisabled("Voice messages are disabled.")
    try:
        seconds = float(duration)
    except (TypeError, ValueError) as exc:
        raise ValidationFailed("duration must be a number of seconds.", code="invalid_voice") from exc
    if not 0 < seconds <= chat_settings.MAX_VOICE_DURATION:
        raise ValidationFailed(
            "The voice message is too long.",
            code="voice_too_long",
            details={"max_duration": chat_settings.MAX_VOICE_DURATION},
        )
    if isinstance(waveform, str):
        try:
            waveform = json.loads(waveform or "[]")
        except ValueError as exc:
            raise ValidationFailed("waveform must be a JSON list.", code="invalid_voice") from exc
    if (
        not isinstance(waveform, list)
        or len(waveform) > MAX_WAVEFORM_BARS
        or not all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 100 for v in waveform)
    ):
        raise ValidationFailed(
            f"waveform must be up to {MAX_WAVEFORM_BARS} integers 0-100.", code="invalid_voice"
        )
    return round(seconds, 2), waveform


def upload_attachment(
    user: Any,
    conversation_id: Any,
    upload: Any,
    *,
    voice: bool = False,
    duration: Any = None,
    waveform: Any = None,
) -> Attachment:
    if not chat_settings.ENABLE_ATTACHMENTS:
        raise FeatureDisabled("Attachments are disabled.")
    voice_meta = _voice_metadata(duration, waveform) if voice else None
    membership = get_membership(user, conversation_id)
    if upload is None:
        raise ValidationFailed("A file is required.", code="file_required")
    if upload.size <= 0:
        raise ValidationFailed("The file is empty.", code="empty_file")
    if upload.size > chat_settings.MAX_ATTACHMENT_SIZE:
        raise ValidationFailed(
            "The file is too large.",
            code="file_too_large",
            details={"max_size": chat_settings.MAX_ATTACHMENT_SIZE},
        )
    pending = Attachment.objects.filter(
        uploaded_by=user, message__isnull=True, created_at__gte=timezone.now() - PENDING_WINDOW
    ).count()
    if pending >= chat_settings.MAX_PENDING_ATTACHMENTS:
        raise ValidationFailed("Too many unsent uploads. Send or remove some first.", code="too_many_pending")
    content_type = sniff_upload(upload)
    if content_type is None or content_type not in chat_settings.ALLOWED_ATTACHMENT_TYPES:
        raise ValidationFailed("This file type is not allowed.", code="unsupported_file_type")
    if voice_meta and not content_type.startswith("audio/"):
        raise ValidationFailed("Voice messages must be audio.", code="invalid_voice")
    width = height = None
    thumbnail = None
    if content_type.startswith("image/"):
        try:
            width, height = image_dimensions(upload)
        except ValueError as exc:
            raise ValidationFailed(str(exc), code="invalid_image") from exc
        thumbnail = make_thumbnail(upload, chat_settings.THUMBNAIL_SIZE)
    attachment = Attachment(
        conversation=membership.conversation,
        uploaded_by=user,
        file=upload,
        original_name=safe_filename(upload.name),
        content_type=content_type,
        size=upload.size,
        width=width,
        height=height,
        is_voice=voice_meta is not None,
        duration=voice_meta[0] if voice_meta else None,
        waveform=voice_meta[1] if voice_meta else None,
    )
    if thumbnail is not None:
        attachment.thumbnail.save(thumbnail.name, thumbnail, save=False)
    attachment.save()
    return attachment


def get_attachment(user: Any, attachment_id: Any) -> Attachment:
    try:
        attachment = Attachment.objects.select_related("conversation").get(pk=attachment_id)
    except (Attachment.DoesNotExist, ValueError, DjangoValidationError) as exc:
        raise NotFound("Attachment not found.") from exc
    try:
        get_membership(user, attachment.conversation_id)
    except NotFound as exc:
        raise NotFound("Attachment not found.") from exc
    if attachment.message_id is None and attachment.uploaded_by_id != user.pk:
        raise NotFound("Attachment not found.")
    return attachment


def discard_attachment(user: Any, attachment_id: Any) -> None:
    attachment = get_attachment(user, attachment_id)
    if attachment.message_id is not None or attachment.uploaded_by_id != user.pk:
        raise PermissionDenied("Only unsent uploads can be removed.")
    attachment.delete()
    delete_attachment_files([attachment])


def delete_attachment_files(attachments: list[Attachment]) -> None:
    """Delete stored files after commit unless another row (e.g. a forward) still uses them."""
    names = [(f.storage, f.name) for a in attachments for f in (a.file, a.thumbnail) if f]

    def cleanup() -> None:
        for storage, name in names:
            if not Attachment.objects.filter(Q(file=name) | Q(thumbnail=name)).exists():
                storage.delete(name)

    if names:
        transaction.on_commit(cleanup)


def purge_stale_uploads(older_than: timedelta = PENDING_WINDOW) -> int:
    stale = list(Attachment.objects.filter(message__isnull=True, created_at__lt=timezone.now() - older_than))
    with transaction.atomic():
        Attachment.objects.filter(pk__in=[a.pk for a in stale]).delete()
        delete_attachment_files(stale)
    return len(stale)

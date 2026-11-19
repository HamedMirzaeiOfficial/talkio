from __future__ import annotations

import os
import uuid

from django.conf import settings
from django.core.files.storage import storages
from django.core.signals import setting_changed
from django.db import models
from django.dispatch import receiver
from django.utils import timezone
from django.utils.functional import LazyObject, empty
from django.utils.translation import gettext_lazy as _

from .conf import chat_settings


class _AttachmentStorage(LazyObject):
    """Resolves ``STORAGES[CHAT_ATTACHMENT_STORAGE]`` lazily (and again after settings change).

    Django evaluates a callable ``storage`` once at import time, so returning the storage
    directly would ignore later configuration such as ``override_settings`` in tests.
    """

    def _setup(self) -> None:
        self._wrapped = storages[chat_settings.ATTACHMENT_STORAGE]


_attachment_storage = _AttachmentStorage()


@receiver(setting_changed)
def _reset_attachment_storage(*, setting: str, **kwargs) -> None:
    if setting in {"STORAGES", "CHAT_ATTACHMENT_STORAGE"}:
        _attachment_storage._wrapped = empty


def attachment_storage():
    return _attachment_storage


def attachment_upload_to(instance: Attachment, filename: str) -> str:
    # Never reuse the client-supplied file name on disk.
    ext = os.path.splitext(filename)[1].lower()[:10]
    folder = timezone.now().strftime(chat_settings.ATTACHMENT_UPLOAD_TO)
    return f"{folder}{uuid.uuid4().hex}{ext}"


class Conversation(models.Model):
    class Kind(models.TextChoices):
        DIRECT = "direct", _("Direct")
        GROUP = "group", _("Group")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=10, choices=Kind.choices)
    title = models.CharField(max_length=120, blank=True)
    description = models.CharField(max_length=500, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # "<lower user pk>:<higher user pk>" for direct conversations; unique so concurrent
    # "start direct chat" requests cannot create duplicates.
    direct_key = models.CharField(max_length=200, null=True, blank=True, unique=True, editable=False)
    last_seq = models.BigIntegerField(default=0)
    last_message_at = models.DateTimeField(null=True, blank=True)
    last_activity_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL, through="Membership", related_name="rtchat_conversations"
    )

    class Meta:
        ordering = ["-last_activity_at", "-id"]
        indexes = [models.Index(fields=["-last_activity_at", "-id"], name="rtchat_conv_activity_idx")]

    def __str__(self) -> str:
        return self.title or f"{self.kind}:{self.pk}"

    @property
    def is_group(self) -> bool:
        return self.kind == self.Kind.GROUP


class Membership(models.Model):
    class Role(models.TextChoices):
        OWNER = "owner", _("Owner")
        ADMIN = "admin", _("Admin")
        MEMBER = "member", _("Member")

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="rtchat_memberships"
    )
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    last_read_seq = models.BigIntegerField(default=0)
    joined_at = models.DateTimeField(default=timezone.now)
    left_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["conversation", "user"], name="rtchat_membership_uniq")
        ]
        indexes = [models.Index(fields=["user", "left_at"], name="rtchat_membership_user_idx")]

    def __str__(self) -> str:
        return f"{self.user_id} in {self.conversation_id} ({self.role})"

    @property
    def is_active(self) -> bool:
        return self.left_at is None

    @property
    def is_admin(self) -> bool:
        return self.role in {self.Role.OWNER, self.Role.ADMIN}


class Message(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="rtchat_messages"
    )
    seq = models.BigIntegerField()
    client_id = models.CharField(max_length=64)
    body = models.TextField(blank=True)
    reply_to = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="replies"
    )
    forwarded_from = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="forwards"
    )
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    pinned_at = models.DateTimeField(null=True, blank=True)
    pinned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    sticker = models.ForeignKey(
        "Sticker", null=True, blank=True, on_delete=models.SET_NULL, related_name="messages"
    )

    class Meta:
        ordering = ["seq"]
        constraints = [
            models.UniqueConstraint(fields=["conversation", "seq"], name="rtchat_message_seq_uniq"),
            models.UniqueConstraint(
                fields=["conversation", "sender", "client_id"], name="rtchat_message_client_id_uniq"
            ),
        ]
        indexes = [models.Index(fields=["conversation", "updated_at"], name="rtchat_message_updated_idx")]

    def __str__(self) -> str:
        return f"{self.conversation_id}#{self.seq}"

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class Attachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="attachments")
    message = models.ForeignKey(
        Message, null=True, blank=True, on_delete=models.CASCADE, related_name="attachments"
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="rtchat_attachments"
    )
    file = models.FileField(storage=attachment_storage, upload_to=attachment_upload_to, max_length=255)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size = models.PositiveBigIntegerField()
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    # WebP preview for large still images (served with ?variant=thumb).
    thumbnail = models.FileField(
        storage=attachment_storage, upload_to=attachment_upload_to, max_length=255, blank=True
    )
    # Voice notes: recorded in the client, played with a waveform.
    is_voice = models.BooleanField(default=False)
    duration = models.FloatField(null=True, blank=True)
    waveform = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["uploaded_by", "message"], name="rtchat_attachment_owner_idx")]

    def __str__(self) -> str:
        return self.original_name


class Reaction(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="rtchat_reactions"
    )
    emoji = models.CharField(max_length=32)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["message", "user", "emoji"], name="rtchat_reaction_uniq")
        ]

    def __str__(self) -> str:
        return f"{self.emoji} by {self.user_id} on {self.message_id}"


class UserPresence(models.Model):
    """Durable part of presence: when a user was last connected. Online state is transient."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, primary_key=True, on_delete=models.CASCADE, related_name="rtchat_presence"
    )
    last_seen_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return f"{self.user_id} last seen {self.last_seen_at:%Y-%m-%d %H:%M}"


def sticker_upload_to(instance: Sticker, filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()[:10]
    return f"chat/stickers/{instance.pack_id}/{uuid.uuid4().hex}{ext}"


class StickerPack(models.Model):
    """Curated by staff in the Django admin; available to every chat user."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=80)
    is_active = models.BooleanField(default=True)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["position", "created_at"]

    def __str__(self) -> str:
        return self.name


class Sticker(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pack = models.ForeignKey(StickerPack, on_delete=models.CASCADE, related_name="stickers")
    #: Emoji the sticker expresses (used for search and accessible names).
    emoji = models.CharField(max_length=32, blank=True)
    file = models.FileField(storage=attachment_storage, upload_to=sticker_upload_to, max_length=255)
    content_type = models.CharField(max_length=50, editable=False)
    width = models.PositiveIntegerField(null=True, blank=True, editable=False)
    height = models.PositiveIntegerField(null=True, blank=True, editable=False)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self) -> str:
        return f"{self.pack.name} {self.emoji}".strip()

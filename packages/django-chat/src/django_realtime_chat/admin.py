from django import forms
from django.contrib import admin
from django.core.exceptions import ValidationError

from .errors import ChatError
from .models import (
    Attachment,
    Conversation,
    Membership,
    Message,
    Reaction,
    Sticker,
    StickerPack,
    UserPresence,
)
from .services.stickers import inspect_sticker_file


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 0
    raw_id_fields = ("user",)
    readonly_fields = ("last_read_seq", "joined_at")


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("id", "kind", "title", "last_seq", "last_activity_at")
    list_filter = ("kind",)
    search_fields = ("title", "id")
    readonly_fields = ("direct_key", "last_seq", "last_message_at", "last_activity_at", "created_at")
    inlines = [MembershipInline]


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    # Message bodies are private correspondence; the list view shows metadata only.
    list_display = ("id", "conversation", "seq", "sender", "created_at", "edited_at", "deleted_at")
    list_filter = ("created_at",)
    raw_id_fields = ("conversation", "sender", "reply_to", "forwarded_from", "pinned_by")
    readonly_fields = ("seq", "client_id", "created_at", "updated_at")


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ("id", "original_name", "content_type", "size", "conversation", "message", "created_at")
    raw_id_fields = ("conversation", "message", "uploaded_by")


admin.site.register(Reaction)
admin.site.register(UserPresence)


class StickerForm(forms.ModelForm):
    class Meta:
        model = Sticker
        fields = ("emoji", "file", "position")

    def clean_file(self):
        upload = self.cleaned_data["file"]
        if hasattr(upload, "content_type"):  # a new upload (not the stored file)
            try:
                self._inspected = inspect_sticker_file(upload)
            except ChatError as exc:
                raise ValidationError(exc.message) from exc
        return upload

    def save(self, commit=True):
        sticker = super().save(commit=False)
        if getattr(self, "_inspected", None):
            sticker.content_type, sticker.width, sticker.height = self._inspected
        if commit:
            sticker.save()
        return sticker


class StickerInline(admin.TabularInline):
    model = Sticker
    form = StickerForm
    extra = 3


@admin.register(StickerPack)
class StickerPackAdmin(admin.ModelAdmin):
    list_display = ("name", "is_active", "position", "created_at")
    list_editable = ("is_active", "position")
    inlines = [StickerInline]

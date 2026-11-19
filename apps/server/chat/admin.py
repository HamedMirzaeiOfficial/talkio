"""Read-only admin for the legacy tables kept as the import source (see ADR 0008)."""

from django.contrib import admin

from .models import ChatRoom, Message


class ReadOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(ChatRoom)
class ChatRoomAdmin(ReadOnlyAdmin):
    list_display = ("id", "name", "kind", "created_at")


@admin.register(Message)
class MessageAdmin(ReadOnlyAdmin):
    list_display = ("id", "chat_room", "sender", "timestamp")

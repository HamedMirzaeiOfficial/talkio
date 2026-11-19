"""Authorization policy.

All services call the policy returned by ``get_policy()``. Hosts extend behaviour by
subclassing ``ChatPolicy`` and setting ``CHAT_POLICY``, e.g. to restrict discovery to
users of the same organisation.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from django.contrib.auth import get_user_model
from django.db.models import QuerySet

from .conf import chat_settings
from .models import Conversation, Membership, Message


class ChatPolicy:
    def flag(self, name: str) -> bool:
        return bool(chat_settings.DEFAULT_PERMISSIONS.get(name, False))

    # --- discovery -------------------------------------------------------------------
    def user_queryset(self, user: Any) -> QuerySet:
        """Users that ``user`` may discover and add to conversations."""
        return get_user_model()._default_manager.filter(is_active=True)

    def can_search_users(self, user: Any) -> bool:
        return chat_settings.ENABLE_USER_SEARCH

    # --- conversations ---------------------------------------------------------------
    def can_start_direct(self, user: Any, other: Any) -> bool:
        return user.pk != other.pk

    def can_create_group(self, user: Any) -> bool:
        return chat_settings.ENABLE_GROUPS

    def can_edit_conversation(self, user: Any, conversation: Conversation, membership: Membership) -> bool:
        if not conversation.is_group:
            return False
        return membership.is_admin or self.flag("members_can_edit_info")

    def can_add_members(self, user: Any, conversation: Conversation, membership: Membership) -> bool:
        if not conversation.is_group:
            return False
        return membership.is_admin or self.flag("members_can_add_members")

    def can_remove_member(
        self, user: Any, conversation: Conversation, membership: Membership, target: Membership
    ) -> bool:
        if not conversation.is_group:
            return False
        if target.user_id == user.pk:
            return True  # leaving
        if target.role == Membership.Role.OWNER:
            return False
        if membership.role == Membership.Role.OWNER:
            return True
        return membership.role == Membership.Role.ADMIN and target.role == Membership.Role.MEMBER

    def can_change_role(
        self, user: Any, conversation: Conversation, membership: Membership, target: Membership, role: str
    ) -> bool:
        return (
            conversation.is_group and membership.role == Membership.Role.OWNER and target.user_id != user.pk
        )

    # --- messages --------------------------------------------------------------------
    def can_send_message(self, user: Any, conversation: Conversation, membership: Membership) -> bool:
        return membership.is_active

    def can_edit_message(self, user: Any, message: Message, membership: Membership) -> bool:
        return message.sender_id == user.pk

    def can_delete_message(self, user: Any, message: Message, membership: Membership) -> bool:
        if message.sender_id == user.pk:
            return True
        return (
            message.conversation.is_group and membership.is_admin and self.flag("admins_can_delete_messages")
        )

    def can_pin_message(self, user: Any, message: Message, membership: Membership) -> bool:
        if not message.conversation.is_group:
            return True
        return membership.is_admin or self.flag("members_can_pin")


@lru_cache(maxsize=4)
def _policy_for(path: Any) -> ChatPolicy:
    return chat_settings.import_setting("POLICY")()


def get_policy() -> ChatPolicy:
    return _policy_for(chat_settings.POLICY)

"""User discovery."""

from __future__ import annotations

from typing import Any

from django.contrib.auth import get_user_model

from ..errors import FeatureDisabled, NotFound, ValidationFailed
from ..models import Membership
from ..permissions import get_policy
from ..serializers import presence_payload, user_profile_payload
from ..users import clean_user_id, get_user_adapter

LIMIT = 20


def search_users(user: Any, query: Any) -> list[dict[str, Any]]:
    """Search discoverable users. An empty query returns people the user already chats with."""
    policy = get_policy()
    if not policy.can_search_users(user):
        raise FeatureDisabled("User search is disabled.")
    query = str(query or "").strip()
    if len(query) > 100:
        raise ValidationFailed("The search is too long.", code="invalid_query")
    base = policy.user_queryset(user).exclude(pk=user.pk)
    if query:
        users = list(get_user_adapter().search(base, query).order_by("pk")[:LIMIT])
    else:
        my_conversations = Membership.objects.filter(user=user, left_at__isnull=True).values(
            "conversation_id"
        )
        peer_ids = (
            Membership.objects.filter(conversation_id__in=my_conversations, left_at__isnull=True)
            .exclude(user=user)
            .values("user_id")
        )
        users = list(base.filter(pk__in=peer_ids).order_by("pk")[:LIMIT])
    adapter = get_user_adapter()
    presence = presence_payload([u.pk for u in users])
    return [{**adapter.serialize(u), **presence.get(u.pk, {})} for u in users]


def get_user_profile(user: Any, user_id: Any) -> dict[str, Any]:
    """Profiles are visible for discoverable users or people sharing a conversation."""
    policy = get_policy()
    user_id = clean_user_id(user_id)
    if user_id is None:
        raise NotFound("User not found.")
    try:
        target = policy.user_queryset(user).get(pk=user_id)
    except get_user_model().DoesNotExist as exc:
        shared = (
            Membership.objects.filter(
                user_id=user_id,
                left_at__isnull=True,
                conversation__memberships__user=user,
                conversation__memberships__left_at__isnull=True,
            )
            .select_related("user")
            .first()
        )
        if shared is None:
            raise NotFound("User not found.") from exc
        target = shared.user
    return user_profile_payload(target)

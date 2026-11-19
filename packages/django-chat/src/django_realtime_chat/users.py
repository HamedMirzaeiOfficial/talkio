"""User adapter: how the package reads and exposes host users.

The package never assumes a particular user model. Hosts can subclass
``DefaultUserAdapter`` and point ``CHAT_USER_ADAPTER`` at it.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from django.contrib.auth import get_user_model
from django.db.models import Q, QuerySet

from .conf import chat_settings


class DefaultUserAdapter:
    #: Model fields matched (icontains) by user search. ``None`` = derive from the model.
    search_fields: tuple[str, ...] | None = None
    avatar_field = "avatar"

    def get_search_fields(self) -> tuple[str, ...]:
        if self.search_fields is not None:
            return self.search_fields
        model = get_user_model()
        names = {f.name for f in model._meta.get_fields()}
        return tuple(name for name in ("username", "first_name", "last_name") if name in names)

    def display_name(self, user: Any) -> str:
        full = (user.get_full_name() or "").strip() if hasattr(user, "get_full_name") else ""
        return full or self.handle(user) or f"User {user.pk}"

    def handle(self, user: Any) -> str | None:
        """Public handle. Defaults to ``username`` when the model has one."""
        value = getattr(user, "username", None)
        return str(value) if value else None

    def avatar_url(self, user: Any) -> str | None:
        field = getattr(user, self.avatar_field, None)
        if field:
            try:
                return field.url
            except ValueError:
                return None
        return None

    def serialize(self, user: Any) -> dict[str, Any]:
        return {
            "id": user.pk,
            "display_name": self.display_name(user),
            "username": self.handle(user),
            "avatar_url": self.avatar_url(user),
        }

    def search(self, queryset: QuerySet, query: str) -> QuerySet:
        condition = Q()
        for field in self.get_search_fields():
            condition |= Q(**{f"{field}__icontains": query})
        return queryset.filter(condition) if condition else queryset.none()


@lru_cache(maxsize=4)
def _adapter_for(path: Any) -> DefaultUserAdapter:
    cls = chat_settings.import_setting("USER_ADAPTER")
    return cls()


def get_user_adapter() -> DefaultUserAdapter:
    return _adapter_for(chat_settings.USER_ADAPTER)


def serialize_user(user: Any) -> dict[str, Any] | None:
    return get_user_adapter().serialize(user) if user is not None else None


_BIGINT_MAX = 2**63 - 1


def clean_user_id(value: Any) -> Any | None:
    """Validate a client-supplied user id for the user model's primary key; None if invalid.

    Prevents malformed or out-of-range ids from reaching the database (which would raise
    ValueError/OverflowError/DataError and surface as 500s).
    """
    from django.core.exceptions import ValidationError

    if isinstance(value, (bool, dict, list)) or value in (None, ""):
        return None
    field = get_user_model()._meta.pk
    try:
        cleaned = field.to_python(value)
    except (ValidationError, TypeError, ValueError):
        return None
    if isinstance(cleaned, int) and not -_BIGINT_MAX <= cleaned <= _BIGINT_MAX:
        return None
    return cleaned

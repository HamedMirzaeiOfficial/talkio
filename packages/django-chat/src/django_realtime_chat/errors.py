"""Domain errors with stable machine-readable codes shared by REST and WebSocket."""

from __future__ import annotations

from typing import Any

from django.utils.translation import gettext_lazy


class ChatError(Exception):
    status = 400
    code = "invalid_request"
    default_message = gettext_lazy("The request is invalid.")

    def __init__(self, message: str | None = None, *, code: str | None = None, details: Any = None):
        # Resolved now, in the language of the request (or WebSocket connection) that raised it.
        self.message = str(message or self.default_message)
        if code:
            self.code = code
        self.details = details
        super().__init__(str(self.message))

    def as_dict(self) -> dict[str, Any]:
        # str() resolves lazy translations in the language of the current request.
        data: dict[str, Any] = {"code": self.code, "message": str(self.message)}
        if self.details is not None:
            data["details"] = self.details
        return data


class ValidationFailed(ChatError):
    code = "validation_error"


class NotFound(ChatError):
    # Used for both "does not exist" and "exists but you are not a member" so private
    # conversations cannot be probed.
    status = 404
    code = "not_found"
    default_message = gettext_lazy("Not found.")


class PermissionDenied(ChatError):
    status = 403
    code = "forbidden"
    default_message = gettext_lazy("You do not have permission to perform this action.")


class FeatureDisabled(ChatError):
    status = 403
    code = "feature_disabled"
    default_message = gettext_lazy("This feature is disabled.")


class RateLimited(ChatError):
    status = 429
    code = "rate_limited"
    default_message = gettext_lazy("Too many requests. Please slow down.")

    def __init__(self, retry_after: float | None = None, **kwargs: Any):
        super().__init__(**kwargs)
        self.retry_after = retry_after
        if retry_after is not None:
            self.details = {"retry_after": round(retry_after, 2)}

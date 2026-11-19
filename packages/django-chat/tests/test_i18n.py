"""The package ships Persian messages; errors are worded in the active language."""

import pytest
from django.utils import translation

from django_realtime_chat.errors import NotFound
from django_realtime_chat.services.users import get_user_profile
from django_realtime_chat.ws.consumer import connection_language


def test_default_message_follows_the_active_language():
    with translation.override("fa"):
        error = NotFound().as_dict()
    # Django's own catalog also translates this generic phrase; either wording is Persian.
    assert error["code"] == "not_found"
    assert error["message"] in {"پیدا نشد.", "یافت نشد."}
    with translation.override("en"):
        assert NotFound().message == "Not found."


def test_service_errors_are_translated(alice):
    with translation.override("fa"), pytest.raises(NotFound) as caught:
        get_user_profile(alice, 999_999)
    assert caught.value.message == "کاربر پیدا نشد."


@pytest.mark.parametrize(
    ("query", "headers", "expected"),
    [
        (b"lang=fa", [], "fa"),
        (b"", [(b"accept-language", b"fa-IR,fa;q=0.9,en;q=0.8")], "fa"),
        (b"lang=fa", [(b"accept-language", b"en-US")], "fa"),
        (b"", [(b"accept-language", b"de-DE")], "en-us"),
        (b"lang=xx", [], "en-us"),
    ],
)
def test_socket_language(settings, query, headers, expected):
    settings.LANGUAGES = [("en-us", "English"), ("fa", "Persian")]
    settings.LANGUAGE_CODE = "en-us"
    assert connection_language({"query_string": query, "headers": headers}) == expected

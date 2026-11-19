from django.core.checks import run_checks

from django_realtime_chat.conf import Rate


def ids(**overrides):
    return {e.id for e in run_checks() if e.id.startswith("realtime_chat")}


def test_default_configuration_is_valid():
    assert {i for i in ids() if ".E" in i} == set()


def test_invalid_values_are_reported(settings):
    settings.CHAT_MAX_MESSAGE_LENGTH = 0
    settings.CHAT_ENABLE_GROUPS = "yes"
    settings.CHAT_PRESENCE_BACKEND = "redis"
    settings.CHAT_RATE_LIMITS = {"http_write": "lots"}
    settings.CHAT_ALLOWED_ATTACHMENT_TYPES = ["image/svg+xml"]
    settings.CHAT_POLICY = "missing.module.Policy"
    settings.CHAT_UNKNOWN = 1
    found = ids()
    assert {
        "realtime_chat.E001",
        "realtime_chat.E002",
        "realtime_chat.E005",
        "realtime_chat.E006",
        "realtime_chat.E007",
        "realtime_chat.E008",
        "realtime_chat.W001",
    } <= found


def test_rate_parsing():
    assert Rate.parse("30/m") == Rate(30, 60.0)
    assert Rate.parse("20/10s") == Rate(20, 10.0)


def test_package_exports():
    import django_realtime_chat
    from django_realtime_chat import routing, urls

    assert django_realtime_chat.__version__
    assert urls.app_name == "realtime_chat"
    assert routing.websocket_urlpatterns and callable(routing.chat_websocket_application)

"""Minimal host project using django.contrib.auth.User (proves no dependency on a custom user)."""

SECRET_KEY = "test-only"
DEBUG = True
USE_TZ = True
ALLOWED_HOSTS = ["testserver", "localhost"]
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.admin",
    "django.contrib.messages",
    "rest_framework",
    "channels",
    "django_realtime_chat",
]
MIDDLEWARE = [
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "django.template.context_processors.request",
            ]
        },
    }
]
ROOT_URLCONF = "tests.urls"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
}
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
CHAT_RATE_LIMITS = {"http_write": "1000/m", "ws_message": "1000/10s"}

# CI runs the suite (including the real-concurrency test) against PostgreSQL.
import os  # noqa: E402
from urllib.parse import parse_qs, urlparse  # noqa: E402

if os.getenv("TEST_DATABASE_URL"):
    _url = urlparse(os.environ["TEST_DATABASE_URL"])
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": _url.path.lstrip("/"),
            "USER": _url.username,
            "PASSWORD": _url.password,
            # Supports TCP hosts and unix sockets (postgresql://u@/db?host=/run/postgresql).
            "HOST": _url.hostname or parse_qs(_url.query).get("host", [""])[0],
            "PORT": _url.port or 5432,
        }
    }

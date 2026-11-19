"""An existing Django project ("Acme CRM") that adds chat with three settings blocks."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = os.getenv("DEBUG", "1") == "1"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "example-only-not-secret")
ALLOWED_HOSTS = ["127.0.0.1", "localhost", "testserver"]
CSRF_TRUSTED_ORIGINS = ["http://127.0.0.1:4811", "http://localhost:4811"]

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "channels",
    # 1) install the app
    "django_realtime_chat",
    "host_project",  # only for the seed_example management command
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]
ROOT_URLCONF = "host_project.urls"
ASGI_APPLICATION = "host_project.asgi.application"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "example.sqlite3"}}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
STATIC_URL = "/static/"
LOGIN_URL = "/login/"
LOGIN_REDIRECT_URL = "/"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    # Attachments go to a private location (or e.g. an S3 bucket without public ACLs).
    "chat_files": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
        "OPTIONS": {"location": str(BASE_DIR / "private_media"), "base_url": None},
    },
}
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
REST_FRAMEWORK = {"DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"]}

# 2) configure chat for this product
CHAT_POLICY = "host_project.policies.TeamPolicy"
CHAT_ATTACHMENT_STORAGE = "chat_files"
CHAT_ENABLE_GROUPS = True
CHAT_MAX_MESSAGE_LENGTH = 2000
CHAT_MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024
CHAT_ALLOWED_ATTACHMENT_TYPES = ["image/png", "image/jpeg", "application/pdf"]
CHAT_DEFAULT_PERMISSIONS = {"members_can_add_members": True}

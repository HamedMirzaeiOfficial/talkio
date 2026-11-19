from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class RealtimeChatConfig(AppConfig):
    name = "django_realtime_chat"
    label = "realtime_chat"
    verbose_name = _("Realtime chat")
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self) -> None:
        from . import checks  # noqa: F401  (registers system checks)

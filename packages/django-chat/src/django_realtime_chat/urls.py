"""Mount with ``path("api/chat/v1/", include("django_realtime_chat.urls"))``.

The URL namespace ``realtime_chat`` is required (attachment URLs are reversed with it).
"""

from .api.urls import urlpatterns as api_urlpatterns

app_name = "realtime_chat"
urlpatterns = api_urlpatterns

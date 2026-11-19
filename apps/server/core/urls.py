"""Root URLconf for the standalone server."""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve

from accounts import api as auth_api

from . import docs
from .health import HealthView, LegacyApiGoneView, ReadinessView

urlpatterns = [
    # Before admin/: the admin's catch-all view would otherwise answer /admin/docs/.
    path("admin/docs/", include(docs.urlpatterns)),
    path("admin/", admin.site.urls),
    path("api/health/", HealthView.as_view(), name="health"),
    path("api/health/ready/", ReadinessView.as_view(), name="readiness"),
    path("api/auth/", include(auth_api.urlpatterns)),
    path("api/chat/v1/", include("django_realtime_chat.urls")),
    # Removed pre-package API: answer with a migration hint instead of a bare 404.
    re_path(r"^api/v1/(?P<rest>.*)$", LegacyApiGoneView.as_view()),
    path("social-auth/", include("social_django.urls", namespace="social")),
]

if settings.DEBUG:
    from django.conf.urls.static import static

    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    # Only avatars are public media. Chat attachments are never served from here.
    urlpatterns += [
        re_path(r"^media/(?P<path>avatars/.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
    ]

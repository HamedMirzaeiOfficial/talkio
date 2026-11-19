from django.conf import settings
from django.db import connection
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    """Liveness: the process answers requests."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        return Response({"status": "ok"})


class ReadinessView(APIView):
    """Readiness: dependencies needed to serve traffic are reachable."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        checks = {"database": False}
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            checks["database"] = True
        except Exception:  # noqa: S110 - reported as not ready
            pass
        if settings.REDIS_URL:
            try:
                import redis

                redis.Redis.from_url(settings.REDIS_URL, socket_timeout=2).ping()
                checks["redis"] = True
            except Exception:
                checks["redis"] = False
        ready = all(checks.values())
        return Response({"status": "ready" if ready else "not_ready", "checks": checks}, status=200 if ready else 503)


class LegacyApiGoneView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def dispatch_gone(self):
        return Response(
            {
                "error": {
                    "code": "api_version_removed",
                    "message": "The /api/v1/ API was replaced by /api/chat/v1/ and /api/auth/. "
                    "See docs/api/migration-from-v1.md.",
                }
            },
            status=410,
        )

    def get(self, request, rest=""):
        return self.dispatch_gone()

    post = put = patch = delete = get

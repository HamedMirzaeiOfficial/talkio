from django.urls import include, path

urlpatterns = [path("api/chat/v1/", include("django_realtime_chat.urls"))]

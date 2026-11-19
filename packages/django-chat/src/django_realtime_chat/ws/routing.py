from django.urls import path

from .consumer import ChatConsumer

websocket_urlpatterns = [
    path("ws/chat/v1/", ChatConsumer.as_asgi(), name="realtime-chat-ws"),
    path(
        "ws/chat/v1/conversations/<uuid:conversation_id>/",
        ChatConsumer.as_asgi(),
        name="realtime-chat-ws-conversation",
    ),
]

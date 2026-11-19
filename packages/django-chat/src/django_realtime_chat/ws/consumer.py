"""WebSocket endpoint: one connection per client, events for all of the user's conversations.

Protocol reference: ``docs/api/websocket.md``. Persistent operations go through the same
services as the REST API; transient signals (typing) go straight to the channel layer.
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone

from .. import PROTOCOL_VERSION
from ..conf import chat_settings
from ..errors import ChatError, NotFound, RateLimited, ValidationFailed
from ..events import HANDLER, conversation_group, user_group
from ..ratelimit import TokenBucket
from ..serializers import message_payload
from ..services import conversations as conversation_service
from ..services import messages as message_service
from ..services import presence as presence_service
from ..users import serialize_user

logger = logging.getLogger("django_realtime_chat")

CLOSE_UNAUTHENTICATED = 4401
CLOSE_NOT_FOUND = 4404
TYPING_MIN_INTERVAL = 2.0
MAX_FRAME_CHARS = 64 * 1024


@database_sync_to_async
def _send_message(user, data: dict[str, Any]) -> dict[str, Any]:
    message, created = message_service.send_message(
        user,
        data.get("conversation_id"),
        body=data.get("body", ""),
        client_id=data.get("client_id"),
        reply_to_id=data.get("reply_to_id"),
        attachment_ids=data.get("attachment_ids") or [],
        sticker_id=data.get("sticker_id"),
    )
    return {"message": message_payload(message), "deduplicated": not created}


@database_sync_to_async
def _mark_read(user, conversation_id, seq) -> dict[str, Any]:
    return {
        "conversation_id": str(conversation_id),
        "last_read_seq": conversation_service.mark_read(user, conversation_id, seq),
    }


class ChatConsumer(AsyncJsonWebsocketConsumer):
    user: Any
    connection_id: str
    subscriptions: set[str]
    scoped_conversation: str | None = None
    registered = False

    async def connect(self) -> None:
        self.user = self.scope.get("user")
        self.connection_id = uuid.uuid4().hex
        self.subscriptions = set()
        self.typing_sent: dict[str, float] = {}
        self.buckets = {
            "message": TokenBucket.for_key("ws_message"),
            "typing": TokenBucket.for_key("ws_typing"),
            "other": TokenBucket.for_key("ws_other"),
        }
        # Accept first so that the client can read an application close code and stop
        # reconnecting (a rejected handshake is indistinguishable from a network error).
        await self.accept()
        if self.user is None or not self.user.is_authenticated:
            await self._error("not_authenticated", "Authentication required.")
            await self.close(code=CLOSE_UNAUTHENTICATED)
            return
        ids = await database_sync_to_async(conversation_service.active_conversation_ids)(self.user)
        scoped = self.scope.get("url_route", {}).get("kwargs", {}).get("conversation_id")
        if scoped is not None:
            scoped = str(scoped)
            if scoped not in ids:
                await self._error("not_found", "Conversation not found.")
                await self.close(code=CLOSE_NOT_FOUND)
                return
            self.scoped_conversation = scoped
            ids = [scoped]
        for cid in ids:
            await self._subscribe(cid)
        await self.channel_layer.group_add(user_group(self.user.pk), self.channel_name)
        self.registered = True
        await database_sync_to_async(presence_service.connection_opened)(self.user.pk, self.connection_id)
        await self.send_json(
            {
                "type": "connection.ready",
                "protocol_version": PROTOCOL_VERSION,
                "connection_id": self.connection_id,
                "user": await database_sync_to_async(serialize_user)(self.user),
                "conversation_ids": ids,
                "heartbeat_interval": max(5, chat_settings.PRESENCE_TTL // 2),
                "server_time": timezone.now().isoformat(),
            }
        )

    async def disconnect(self, code: int) -> None:
        if not self.registered:
            return
        self.registered = False
        for cid in list(self.subscriptions):
            await self.channel_layer.group_discard(conversation_group(cid), self.channel_name)
        await self.channel_layer.group_discard(user_group(self.user.pk), self.channel_name)
        await database_sync_to_async(presence_service.connection_closed)(self.user.pk, self.connection_id)

    async def receive(self, text_data=None, bytes_data=None, **kwargs):
        if text_data is None or len(text_data) > MAX_FRAME_CHARS:
            await self._error("invalid_frame", "Frames must be JSON text under 64 KB.")
            return
        await super().receive(text_data=text_data, bytes_data=bytes_data, **kwargs)

    @classmethod
    async def decode_json(cls, text_data):
        import json

        try:
            return json.loads(text_data)
        except ValueError:
            return None

    async def receive_json(self, content: Any, **kwargs) -> None:
        if not self.registered:
            return
        request_id = content.get("request_id") if isinstance(content, dict) else None
        if request_id is not None and (not isinstance(request_id, str) or len(request_id) > 64):
            request_id = None
        try:
            if not isinstance(content, dict) or not isinstance(content.get("type"), str):
                raise ValidationFailed("Events must be JSON objects with a 'type'.", code="invalid_event")
            await self._dispatch(content["type"], content, request_id)
        except ChatError as exc:
            await self._error(exc.code, exc.message, request_id=request_id, details=exc.details)
        except Exception:
            logger.exception("chat websocket event failed", extra={"event_type": content.get("type")})
            await self._error(
                "internal_error", "The server could not process this event.", request_id=request_id
            )

    async def _dispatch(self, event_type: str, content: dict[str, Any], request_id: str | None) -> None:
        if event_type == "ping":
            self._limit("other")
            await database_sync_to_async(presence_service.heartbeat)(self.user.pk, self.connection_id)
            await self.send_json(
                {"type": "pong", "request_id": request_id, "server_time": timezone.now().isoformat()}
            )
        elif event_type == "message.send":
            self._limit("message")
            self._require_subscription(content.get("conversation_id"))
            result = await _send_message(self.user, content)
            await self.send_json({"type": "ack", "request_id": request_id, "data": result})
        elif event_type in {"typing.start", "typing.stop"}:
            self._limit("typing")
            await self._typing(content.get("conversation_id"), event_type == "typing.start")
        elif event_type == "read.mark":
            self._limit("other")
            conversation_id = self._require_subscription(content.get("conversation_id"))
            result = await _mark_read(self.user, conversation_id, content.get("seq"))
            await self.send_json({"type": "ack", "request_id": request_id, "data": result})
        else:
            raise ValidationFailed(f"Unsupported event type {event_type[:40]!r}.", code="unknown_event")

    def _limit(self, category: str) -> None:
        wait = self.buckets[category].take()
        if wait is not None:
            raise RateLimited(retry_after=wait)

    def _require_subscription(self, conversation_id: Any) -> str:
        cid = str(conversation_id or "")
        if cid not in self.subscriptions:
            raise NotFound("Conversation not found.")
        return cid

    async def _typing(self, conversation_id: Any, is_typing: bool) -> None:
        cid = self._require_subscription(conversation_id)
        now = time.monotonic()
        if is_typing:
            if now - self.typing_sent.get(cid, 0) < TYPING_MIN_INTERVAL:
                return  # server-side throttle; clients re-send while the user keeps typing
            self.typing_sent[cid] = now
        else:
            if cid not in self.typing_sent:
                return
            self.typing_sent.pop(cid, None)
        await self.channel_layer.group_send(
            conversation_group(cid),
            {
                "type": HANDLER,
                "event": {
                    "type": "typing.updated",
                    "conversation_id": cid,
                    "user_id": self.user.pk,
                    "is_typing": is_typing,
                    "expires_in": chat_settings.TYPING_TIMEOUT,
                },
            },
        )

    async def _subscribe(self, conversation_id: str) -> None:
        if conversation_id not in self.subscriptions:
            self.subscriptions.add(conversation_id)
            await self.channel_layer.group_add(conversation_group(conversation_id), self.channel_name)

    async def _unsubscribe(self, conversation_id: str) -> None:
        if conversation_id in self.subscriptions:
            self.subscriptions.discard(conversation_id)
            await self.channel_layer.group_discard(conversation_group(conversation_id), self.channel_name)

    async def chat_event(self, message: dict[str, Any]) -> None:
        """Channel-layer handler for every broadcast (see ``events.HANDLER``)."""
        event = message.get("event") or {}
        event_type = event.get("type")
        if event_type == "conversation.updated":
            cid = str(event.get("conversation", {}).get("id"))
            if self.scoped_conversation and cid != self.scoped_conversation:
                return
            await self._subscribe(cid)
        elif event_type == "conversation.removed":
            cid = str(event.get("conversation_id"))
            await self._unsubscribe(cid)
        elif event.get("conversation_id") not in self.subscriptions:
            return  # stale delivery after leaving a conversation
        elif event_type == "typing.updated" and event.get("user_id") == self.user.pk:
            return
        await self.send_json(event)

    async def _error(
        self, code: str, message: str, *, request_id: str | None = None, details: Any = None
    ) -> None:
        payload: dict[str, Any] = {"type": "error", "code": code, "message": message}
        if request_id:
            payload["request_id"] = request_id
        if details is not None:
            payload["details"] = details
        await self.send_json(payload)

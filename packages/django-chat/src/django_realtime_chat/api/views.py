"""REST API (``/api/chat/v1/``). Views are thin: parse input, call a service, serialize."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from django.http import FileResponse
from django.utils.translation import gettext
from rest_framework import exceptions as drf_exceptions
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.views import APIView

from .. import PROTOCOL_VERSION, __version__
from ..conf import chat_settings
from ..errors import ChatError, RateLimited, ValidationFailed
from ..ratelimit import SearchThrottle, UploadThrottle, WriteThrottle
from ..serializers import attachment_payload, conversation_payload, message_payload, sticker_pack_payload
from ..services import attachments as attachment_service
from ..services import conversations as conversation_service
from ..services import messages as message_service
from ..services import stickers as sticker_service
from ..services import users as user_service
from ..ws.tickets import issue_ticket

SAFE_METHODS = ("GET", "HEAD", "OPTIONS")
_INLINE_TYPES = ("image/", "audio/", "video/")


class ChatAPIView(APIView):
    """Base view: authenticated only, uniform ``{"error": {...}}`` envelope."""

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]
    write_throttle = WriteThrottle

    def get_authenticators(self):
        classes = chat_settings.API_AUTHENTICATION_CLASSES
        if classes is None:
            return super().get_authenticators()
        from django.utils.module_loading import import_string

        return [import_string(c)() if isinstance(c, str) else c() for c in classes]

    def get_throttles(self):
        throttles = [t() for t in api_settings.DEFAULT_THROTTLE_CLASSES]
        if self.request.method not in SAFE_METHODS and self.write_throttle is not None:
            throttles.append(self.write_throttle())
        return throttles

    def throttled(self, request, wait):
        raise RateLimited(retry_after=wait)

    def handle_exception(self, exc):
        if isinstance(exc, ChatError):
            response = Response({"error": exc.as_dict()}, status=exc.status)
            if isinstance(exc, RateLimited) and exc.retry_after:
                response["Retry-After"] = str(int(exc.retry_after) + 1)
            return response
        if isinstance(exc, (drf_exceptions.NotAuthenticated, drf_exceptions.AuthenticationFailed)):
            response = super().handle_exception(exc)
            response.data = {"error": {"code": "not_authenticated", "message": "Authentication required."}}
            return response
        if isinstance(exc, drf_exceptions.APIException):
            response = super().handle_exception(exc)
            code = exc.get_codes() if isinstance(exc.get_codes(), str) else "invalid_request"
            response.data = {"error": {"code": code, "message": _flatten(exc.detail)}}
            return response
        return super().handle_exception(exc)


def _flatten(detail: Any) -> str:
    if isinstance(detail, dict):
        return "; ".join(f"{k}: {_flatten(v)}" for k, v in detail.items())
    if isinstance(detail, list):
        return "; ".join(_flatten(v) for v in detail)
    return str(detail)


def _data(request: Request) -> dict[str, Any]:
    if not isinstance(request.data, dict):
        raise ValidationFailed(gettext("Expected a JSON object."), code="invalid_body")
    return request.data


def _bool(value: Any) -> bool:
    return str(value).lower() in {"1", "true", "yes"}


# --- configuration ------------------------------------------------------------------


class ConfigView(ChatAPIView):
    def get(self, request):
        return Response(
            {
                "version": __version__,
                "protocol_version": PROTOCOL_VERSION,
                "user": user_service.user_profile_payload(request.user),
                "features": {
                    "groups": chat_settings.ENABLE_GROUPS,
                    "attachments": chat_settings.ENABLE_ATTACHMENTS,
                    "reactions": chat_settings.ENABLE_REACTIONS,
                    "user_search": chat_settings.ENABLE_USER_SEARCH,
                    "stickers": chat_settings.ENABLE_STICKERS,
                    "voice": chat_settings.ENABLE_VOICE and chat_settings.ENABLE_ATTACHMENTS,
                },
                "limits": {
                    "max_message_length": chat_settings.MAX_MESSAGE_LENGTH,
                    "max_attachment_size": chat_settings.MAX_ATTACHMENT_SIZE,
                    "max_attachments_per_message": chat_settings.MAX_ATTACHMENTS_PER_MESSAGE,
                    "max_group_members": chat_settings.MAX_GROUP_MEMBERS,
                    "edit_window": chat_settings.EDIT_WINDOW,
                    "max_voice_duration": chat_settings.MAX_VOICE_DURATION,
                },
                "allowed_attachment_types": list(chat_settings.ALLOWED_ATTACHMENT_TYPES),
                "allowed_reactions": (
                    None if chat_settings.ALLOWED_REACTIONS is None else list(chat_settings.ALLOWED_REACTIONS)
                ),
                "quick_reactions": list(chat_settings.QUICK_REACTIONS),
                "presence_ttl": chat_settings.PRESENCE_TTL,
                "typing_timeout": chat_settings.TYPING_TIMEOUT,
            }
        )


class SocketTicketView(ChatAPIView):
    """Short-lived, single-use ticket for WebSocket auth when cookies are unavailable."""

    def post(self, request):
        return Response({"ticket": issue_ticket(request.user), "expires_in": chat_settings.WS_TICKET_TTL})


# --- conversations ------------------------------------------------------------------


class ConversationListView(ChatAPIView):
    def get(self, request):
        params = request.query_params
        return Response(
            conversation_service.list_conversations(
                request.user,
                before=params.get("before"),
                kind=params.get("kind"),
                query=params.get("q", "").strip() or None,
                limit=int(params.get("limit", 50)) if str(params.get("limit", "50")).isdigit() else 50,
            )
        )

    def post(self, request):
        data = _data(request)
        kind = data.get("kind")
        if kind == "direct":
            conv, created = conversation_service.start_direct(request.user, data.get("user_id"))
        elif kind == "group":
            conv = conversation_service.create_group(
                request.user,
                title=data.get("title", ""),
                member_ids=data.get("member_ids", []),
                description=data.get("description", ""),
            )
            created = True
        else:
            raise ValidationFailed(gettext("kind must be 'direct' or 'group'."), code="invalid_kind")
        return Response(
            {"conversation": conversation_payload(conv, request.user), "created": created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class ConversationDetailView(ChatAPIView):
    def get(self, request, conversation_id):
        return Response(
            {"conversation": conversation_service.get_conversation(request.user, conversation_id)}
        )

    def patch(self, request, conversation_id):
        conv = conversation_service.update_conversation(request.user, conversation_id, _data(request))
        return Response({"conversation": conversation_payload(conv, request.user)})


class ConversationReadView(ChatAPIView):
    def post(self, request, conversation_id):
        seq = conversation_service.mark_read(request.user, conversation_id, _data(request).get("seq"))
        return Response({"conversation_id": str(conversation_id), "last_read_seq": seq})


class MemberListView(ChatAPIView):
    def get(self, request, conversation_id):
        return Response(
            {"results": conversation_service.get_conversation(request.user, conversation_id)["members"]}
        )

    def post(self, request, conversation_id):
        added = conversation_service.add_members(
            request.user, conversation_id, _data(request).get("user_ids", [])
        )
        payload = conversation_service.get_conversation(request.user, conversation_id)
        return Response({"added_user_ids": [u.pk for u in added], "conversation": payload}, status=201)


class MemberDetailView(ChatAPIView):
    def patch(self, request, conversation_id, user_id):
        conversation_service.change_role(request.user, conversation_id, user_id, _data(request).get("role"))
        return Response(
            {"conversation": conversation_service.get_conversation(request.user, conversation_id)}
        )

    def delete(self, request, conversation_id, user_id):
        conversation_service.remove_member(request.user, conversation_id, user_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- messages -----------------------------------------------------------------------


class MessageListView(ChatAPIView):
    def get(self, request, conversation_id):
        p = request.query_params
        return Response(
            message_service.list_messages(
                request.user,
                conversation_id,
                before=p.get("before"),
                after=p.get("after"),
                limit=p.get("limit"),
                updated_since=p.get("updated_since"),
                pinned=_bool(p.get("pinned")),
            )
        )

    def post(self, request, conversation_id):
        data = _data(request)
        message, created = message_service.send_message(
            request.user,
            conversation_id,
            body=data.get("body", ""),
            client_id=data.get("client_id"),
            reply_to_id=data.get("reply_to_id"),
            attachment_ids=data.get("attachment_ids", []),
            sticker_id=data.get("sticker_id"),
        )
        return Response(
            {"message": message_payload(message), "deduplicated": not created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class MessageDetailView(ChatAPIView):
    def patch(self, request, message_id):
        message = message_service.edit_message(request.user, message_id, _data(request).get("body"))
        return Response({"message": message_payload(message)})

    def delete(self, request, message_id):
        message = message_service.delete_message(request.user, message_id)
        return Response({"message": message_payload(message)})


class MessageReactionView(ChatAPIView):
    def post(self, request, message_id):
        return Response(
            message_service.toggle_reaction(request.user, message_id, _data(request).get("emoji"))
        )


class MessagePinView(ChatAPIView):
    def post(self, request, message_id):
        message = message_service.toggle_pin(request.user, message_id)
        return Response({"message": message_payload(message), "active": message.pinned_at is not None})


class MessageForwardView(ChatAPIView):
    def post(self, request, message_id):
        data = _data(request)
        message, created = message_service.forward_message(
            request.user, message_id, data.get("conversation_id"), data.get("client_id")
        )
        return Response(
            {"message": message_payload(message), "deduplicated": not created}, status=201 if created else 200
        )


class MessageSearchView(ChatAPIView):
    write_throttle = None

    def get_throttles(self):
        return [*super().get_throttles(), SearchThrottle()]

    def get(self, request):
        p = request.query_params
        return Response(
            message_service.search_messages(
                request.user, p.get("q"), conversation_id=p.get("conversation_id"), before=p.get("before")
            )
        )


# --- users --------------------------------------------------------------------------


class UserSearchView(ChatAPIView):
    def get_throttles(self):
        return [*super().get_throttles(), SearchThrottle()]

    def get(self, request):
        return Response(
            {"results": user_service.search_users(request.user, request.query_params.get("q", ""))}
        )


class UserDetailView(ChatAPIView):
    def get(self, request, user_id):
        return Response({"user": user_service.get_user_profile(request.user, user_id)})


# --- attachments --------------------------------------------------------------------


class AttachmentUploadView(ChatAPIView):
    parser_classes = [MultiPartParser, FormParser]
    write_throttle = UploadThrottle

    def post(self, request):
        data = request.data
        attachment = attachment_service.upload_attachment(
            request.user,
            data.get("conversation_id"),
            request.FILES.get("file"),
            voice=_bool(data.get("voice")),
            duration=data.get("duration"),
            waveform=data.get("waveform"),
        )
        return Response({"attachment": attachment_payload(attachment)}, status=status.HTTP_201_CREATED)


class AttachmentDetailView(ChatAPIView):
    def get(self, request, attachment_id):
        return Response(
            {"attachment": attachment_payload(attachment_service.get_attachment(request.user, attachment_id))}
        )

    def delete(self, request, attachment_id):
        attachment_service.discard_attachment(request.user, attachment_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AttachmentDownloadView(ChatAPIView):
    def get(self, request, attachment_id):
        attachment = attachment_service.get_attachment(request.user, attachment_id)
        if request.query_params.get("variant") == "thumb" and attachment.thumbnail:
            response = FileResponse(attachment.thumbnail.open("rb"), content_type="image/webp")
            return _harden(response, "inline", attachment.original_name)
        response = FileResponse(attachment.file.open("rb"), content_type=attachment.content_type)
        disposition = "inline" if attachment.content_type.startswith(_INLINE_TYPES) else "attachment"
        return _harden(response, disposition, attachment.original_name)


def _harden(response: FileResponse, disposition: str, name: str) -> FileResponse:
    """Headers for serving user-provided files without letting the browser interpret them."""
    response["Content-Disposition"] = f"{disposition}; filename*=UTF-8''{quote(name)}"
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    response["Cache-Control"] = "private, max-age=3600"
    response["Cross-Origin-Resource-Policy"] = "same-site"
    return response


# --- stickers -----------------------------------------------------------------------


class StickerPackListView(ChatAPIView):
    def get(self, request):
        return Response({"results": [sticker_pack_payload(p) for p in sticker_service.list_packs()]})


class StickerFileView(ChatAPIView):
    def get(self, request, sticker_id):
        sticker = sticker_service.get_sticker(sticker_id)
        response = _harden(
            FileResponse(sticker.file.open("rb"), content_type=sticker.content_type), "inline", "sticker"
        )
        response["Cache-Control"] = "private, max-age=86400, immutable"
        return response

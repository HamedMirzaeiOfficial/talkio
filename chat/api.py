from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import connection
from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from urllib.parse import quote
from django.http import FileResponse
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User

from .models import Attachment, ChatRoom, Message, MessageReaction


MAX_MESSAGE_LENGTH = 4000
MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
ALLOWED_ATTACHMENT_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'}


def user_payload(user):
    return {
        'id': user.pk,
        'username': user.username,
        'display_name': user.get_full_name() or user.username,
        'email': user.email,
    }


def room_payload(room, last_message=None):
    return {
        'slug': room.slug,
        'name': room.name,
        'kind': room.kind,
        'members': [user_payload(user) for user in room.users.all()],
        'last_message': message_payload(last_message) if last_message else None,
    }


def message_payload(message):
    return {
        'id': str(message.server_id or message.pk),
        'client_id': message.client_id,
        'conversation': message.chat_room.slug,
        'body': '' if message.deleted_at else message.message,
        'sender': user_payload(message.sender),
        'created_at': message.timestamp.isoformat(),
        'edited_at': message.edited_at.isoformat() if message.edited_at else None,
        'deleted_at': message.deleted_at.isoformat() if message.deleted_at else None,
        'attachments': [{'id': item.pk, 'name': item.original_name, 'content_type': item.content_type, 'size': item.size, 'url': f'/api/v1/attachments/{item.pk}/'} for item in message.attachments.all()],
        'reactions': list(message.reactions.values('emoji').annotate(count=Count('id'))),
    }


class SessionLoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        phone = str(request.data.get('phone', '')).strip()
        code = str(request.data.get('code', '')).strip()
        if settings.DEMO_AUTH_ENABLED:
            if not phone or code != settings.DEMO_AUTH_CODE or not phone.isdigit():
                return Response({'error': {'code': 'invalid_demo_credentials', 'message': 'Enter a valid phone number and demo code.'}}, status=401)
            user, _ = User.objects.get_or_create(phone=phone, defaults={'username': phone})
            login(request, user, backend='accounts.authentication.CustomModelBackend')
            return Response({'user': user_payload(user), 'demo': True})
        identifier = str(request.data.get('identifier', '')).strip()
        password = request.data.get('password', '')
        if not identifier or not password:
            return Response({'error': {'code': 'invalid_credentials', 'message': 'Credentials are required.'}}, status=400)
        user = authenticate(request, username=identifier, password=password)
        if user is None:
            return Response({'error': {'code': 'invalid_credentials', 'message': 'Invalid credentials.'}}, status=401)
        login(request, user, backend='accounts.authentication.CustomModelBackend')
        return Response({'user': user_payload(user)})


class SessionRegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        phone = str(request.data.get('phone', '')).strip()
        password = request.data.get('password', '')
        password_confirm = request.data.get('password_confirm', '')
        email = str(request.data.get('email', '')).strip() or None
        if not phone or password != password_confirm:
            return Response({'error': {'code': 'invalid_registration', 'message': 'Phone and matching passwords are required.'}}, status=400)
        if User.objects.filter(phone=phone).exists():
            return Response({'error': {'code': 'phone_taken', 'message': 'This phone number is already registered.'}}, status=409)
        try:
            validate_password(password)
        except ValidationError as exc:
            return Response({'error': {'code': 'weak_password', 'message': ' '.join(exc.messages)}}, status=400)
        user = User.objects.create_user(phone=phone, email=email, password=password)
        login(request, user, backend='accounts.authentication.CustomModelBackend')
        return Response({'user': user_payload(user)}, status=201)


class CsrfView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({'csrf_token': get_token(request)})


class SessionLogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CurrentUserView(APIView):
    def get(self, request):
        return Response({'user': user_payload(request.user)})


class ConversationListView(APIView):
    def get(self, request):
        rooms = ChatRoom.objects.filter(users=request.user).prefetch_related('users')
        data = []
        for room in rooms:
            last_message = room.message_set.select_related('sender').order_by('-timestamp', '-pk').first()
            data.append({
                'slug': room.slug,
                'name': room.name,
                'kind': room.kind,
                'members': [user_payload(user) for user in room.users.all()],
                'last_message': message_payload(last_message) if last_message else None,
            })
        return Response({'results': data})

    def post(self, request):
        kind = str(request.data.get('kind', 'group')).strip()
        name = str(request.data.get('name', '')).strip()
        member_ids = request.data.get('member_ids', [])
        if kind not in {'direct', 'group'} or not isinstance(member_ids, list) or not member_ids or len(member_ids) > 50:
            return Response({'error': {'code': 'invalid_conversation', 'message': 'Choose valid members for this conversation.'}}, status=400)
        if kind == 'group' and (not name or len(name) > 100):
            return Response({'error': {'code': 'invalid_conversation', 'message': 'A group name is required.'}}, status=400)
        users = list(User.objects.filter(pk__in=member_ids))
        if len(users) != len(set(member_ids)):
            return Response({'error': {'code': 'invalid_members', 'message': 'One or more members do not exist.'}}, status=400)
        if request.user in users:
            users.remove(request.user)
        if not users:
            return Response({'error': {'code': 'invalid_members', 'message': 'Choose at least one other user.'}}, status=400)
        if kind == 'direct':
            if len(users) != 1:
                return Response({'error': {'code': 'invalid_direct_members', 'message': 'A direct chat must have one other user.'}}, status=400)
            existing = next((candidate for candidate in ChatRoom.objects.filter(kind='direct', users=request.user).prefetch_related('users') if set(candidate.users.values_list('pk', flat=True)) == {request.user.pk, users[0].pk}), None)
            if existing:
                return Response(room_payload(existing), status=200)
            name = users[0].get_full_name() or users[0].username
        try:
            with transaction.atomic():
                room = ChatRoom.objects.create(name=name, kind=kind)
                room.users.add(request.user, *users)
        except IntegrityError:
            return Response({'error': {'code': 'conversation_exists', 'message': 'Conversation could not be created.'}}, status=409)
        return Response(room_payload(room), status=201)


class UserDirectoryView(APIView):
    def get(self, request):
        query = str(request.query_params.get('q', '')).strip()
        users = User.objects.exclude(pk=request.user.pk)
        if query:
            from django.db.models import Q
            users = users.filter(Q(username__icontains=query) | Q(first_name__icontains=query) | Q(last_name__icontains=query))
        return Response({'results': [user_payload(user) for user in users.order_by('first_name', 'last_name', 'username')[:30]]})


class ConversationMessagesView(APIView):
    page_size = 50

    def get_room(self, request, slug):
        return ChatRoom.objects.filter(users=request.user, slug=slug).first()

    def get(self, request, slug):
        room = self.get_room(request, slug)
        if room is None:
            return Response({'error': {'code': 'not_found', 'message': 'Conversation not found.'}}, status=404)
        queryset = Message.objects.filter(chat_room=room).select_related('sender').order_by('-timestamp', '-pk')
        before = request.query_params.get('before')
        if before:
            cursor = parse_datetime(before)
            if cursor is None:
                return Response({'error': {'code': 'invalid_cursor', 'message': 'Invalid cursor.'}}, status=400)
            queryset = queryset.filter(timestamp__lt=cursor)
        messages = list(queryset[: self.page_size + 1])
        has_more = len(messages) > self.page_size
        messages = messages[: self.page_size]
        next_cursor = messages[-1].timestamp.isoformat() if has_more and messages else None
        return Response({'results': [message_payload(item) for item in messages], 'next_cursor': next_cursor})

    def post(self, request, slug):
        room = self.get_room(request, slug)
        if room is None:
            return Response({'error': {'code': 'not_found', 'message': 'Conversation not found.'}}, status=404)
        body = str(request.data.get('body', '')).strip()
        client_id = str(request.data.get('client_id', '')).strip()
        if not body or len(body) > MAX_MESSAGE_LENGTH:
            return Response({'error': {'code': 'invalid_body', 'message': 'Message length is invalid.'}}, status=400)
        if not client_id or len(client_id) > 64:
            return Response({'error': {'code': 'invalid_client_id', 'message': 'A client_id is required.'}}, status=400)
        existing = Message.objects.filter(chat_room=room, sender=request.user, client_id=client_id).select_related('sender').first()
        if existing:
            return Response({'message': message_payload(existing), 'deduplicated': True})
        if not cache.add(f'chat-message-rate:{request.user.pk}', True, timeout=1):
            return Response({'error': {'code': 'rate_limited', 'message': 'Please slow down and retry shortly.'}}, status=429)
        try:
            with transaction.atomic():
                message = Message.objects.create(chat_room=room, sender=request.user, message=body, client_id=client_id)
        except IntegrityError:
            message = Message.objects.get(chat_room=room, sender=request.user, client_id=client_id)
        return Response({'message': message_payload(message)}, status=status.HTTP_201_CREATED)


class MessageDetailView(APIView):
    def get_message(self, request, server_id):
        return Message.objects.filter(server_id=server_id, chat_room__users=request.user).select_related('sender', 'chat_room').first()

    def patch(self, request, server_id):
        message = self.get_message(request, server_id)
        if message is None:
            return Response({'error': {'code': 'not_found', 'message': 'Message not found.'}}, status=404)
        if message.sender_id != request.user.pk or message.deleted_at:
            return Response({'error': {'code': 'forbidden', 'message': 'Only the sender can edit this message.'}}, status=403)
        body = str(request.data.get('body', '')).strip()
        if not body or len(body) > MAX_MESSAGE_LENGTH:
            return Response({'error': {'code': 'invalid_body', 'message': 'Message length is invalid.'}}, status=400)
        message.message = body
        message.edited_at = timezone.now()
        message.save(update_fields=['message', 'edited_at', 'updated_at'])
        return Response({'message': message_payload(message)})

    def delete(self, request, server_id):
        message = self.get_message(request, server_id)
        if message is None:
            return Response({'error': {'code': 'not_found', 'message': 'Message not found.'}}, status=404)
        if message.sender_id != request.user.pk:
            return Response({'error': {'code': 'forbidden', 'message': 'Only the sender can delete this message.'}}, status=403)
        message.deleted_at = timezone.now()
        message.save(update_fields=['deleted_at', 'updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)


class MessageReactionView(APIView):
    allowed_emojis = {'👍', '❤️', '😂', '😮', '😢', '🔥'}

    def post(self, request, server_id):
        message = Message.objects.filter(server_id=server_id, chat_room__users=request.user).first()
        emoji = str(request.data.get('emoji', '')).strip()
        if message is None:
            return Response({'error': {'code': 'not_found', 'message': 'Message not found.'}}, status=404)
        if emoji not in self.allowed_emojis:
            return Response({'error': {'code': 'invalid_reaction', 'message': 'This reaction is not supported.'}}, status=400)
        reaction, created = MessageReaction.objects.get_or_create(message=message, user=request.user, emoji=emoji)
        if not created:
            reaction.delete()
        return Response({'message_id': str(message.server_id), 'emoji': emoji, 'active': created})


class AttachmentUploadView(APIView):
    def post(self, request):
        message_id = request.data.get('message_id')
        message = Message.objects.filter(server_id=message_id, chat_room__users=request.user).first()
        upload = request.FILES.get('file')
        if message is None or upload is None:
            return Response({'error': {'code': 'not_found', 'message': 'Message or file not found.'}}, status=404)
        if upload.size > MAX_ATTACHMENT_SIZE or upload.content_type not in ALLOWED_ATTACHMENT_TYPES:
            return Response({'error': {'code': 'unsafe_attachment', 'message': 'File type or size is not allowed.'}}, status=400)
        attachment = Attachment.objects.create(message=message, uploaded_by=request.user, file=upload, original_name=upload.name[:255], content_type=upload.content_type, size=upload.size)
        return Response({'id': attachment.pk, 'name': attachment.original_name, 'content_type': attachment.content_type, 'size': attachment.size}, status=201)


class AttachmentDownloadView(APIView):
    def get(self, request, attachment_id):
        attachment = Attachment.objects.filter(pk=attachment_id, message__chat_room__users=request.user).first()
        if attachment is None:
            return Response({'error': {'code': 'not_found', 'message': 'Attachment not found.'}}, status=404)
        response = FileResponse(attachment.file.open('rb'), content_type=attachment.content_type)
        response['Content-Disposition'] = f"attachment; filename*=UTF-8''{quote(attachment.original_name)}"
        return response


class HealthView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({'status': 'ok'})


class ReadinessView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        checks = {'database': False}
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1')
            checks['database'] = True
        except Exception:
            pass
        if settings.USE_REDIS_CHANNEL_LAYER:
            try:
                import redis
                redis.Redis.from_url(settings.REDIS_URL).ping()
                checks['redis'] = True
            except Exception:
                checks['redis'] = False
        ready = all(checks.values())
        return Response({'status': 'ready' if ready else 'not_ready', 'checks': checks}, status=200 if ready else 503)

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.password_validation import validate_password
from django.db import IntegrityError, transaction
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User

from .models import ChatRoom, Message


MAX_MESSAGE_LENGTH = 4000


def user_payload(user):
    return {
        'id': user.pk,
        'username': user.username,
        'display_name': user.get_full_name() or user.username,
        'email': user.email,
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
    }


class SessionLoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        identifier = str(request.data.get('identifier', '')).strip()
        password = request.data.get('password', '')
        if not identifier or not password:
            return Response({'error': {'code': 'invalid_credentials', 'message': 'Credentials are required.'}}, status=400)
        user = authenticate(request, username=identifier, password=password)
        if user is None:
            return Response({'error': {'code': 'invalid_credentials', 'message': 'Invalid credentials.'}}, status=401)
        login(request, user)
        return Response({'user': user_payload(user)})


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
                'members': [user_payload(user) for user in room.users.all()],
                'last_message': message_payload(last_message) if last_message else None,
            })
        return Response({'results': data})

    def post(self, request):
        name = str(request.data.get('name', '')).strip()
        member_ids = request.data.get('member_ids', [])
        if not name or len(name) > 100 or not isinstance(member_ids, list):
            return Response({'error': {'code': 'invalid_conversation', 'message': 'A valid name and member_ids list are required.'}}, status=400)
        users = list(User.objects.filter(pk__in=member_ids))
        if len(users) != len(set(member_ids)):
            return Response({'error': {'code': 'invalid_members', 'message': 'One or more members do not exist.'}}, status=400)
        try:
            with transaction.atomic():
                room = ChatRoom.objects.create(name=name)
                room.users.add(request.user, *users)
        except IntegrityError:
            return Response({'error': {'code': 'conversation_exists', 'message': 'Conversation could not be created.'}}, status=409)
        return Response({'slug': room.slug, 'name': room.name, 'members': [user_payload(user) for user in room.users.all()]}, status=201)


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


class HealthView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({'status': 'ok'})

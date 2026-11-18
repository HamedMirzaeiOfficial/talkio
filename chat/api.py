from django.contrib.auth import authenticate, login, logout
from django.db import IntegrityError, transaction
from django.middleware.csrf import get_token
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


class HealthView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({'status': 'ok'})

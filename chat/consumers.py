import uuid

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db import IntegrityError, models, transaction
from django.utils import timezone

from .models import ChatRoom, Message, UserStatus

MAX_MESSAGE_LENGTH = 4000


@database_sync_to_async
def get_authorized_room(slug, user):
    if not user or not user.is_authenticated:
        return None
    return ChatRoom.objects.filter(slug=slug, users=user).first()


@database_sync_to_async
def open_presence(user):
    status, _ = UserStatus.objects.get_or_create(user=user)
    UserStatus.objects.filter(pk=status.pk).update(active_connections=models.F('active_connections') + 1, online=True)
    return status.pk


@database_sync_to_async
def close_presence(status_id):
    with transaction.atomic():
        status = UserStatus.objects.filter(pk=status_id).first()
        if status is None:
            return
        UserStatus.objects.filter(pk=status.pk, active_connections__gt=0).update(
            active_connections=models.F('active_connections') - 1,
            last_seen_at=timezone.now(),
        )
        status.refresh_from_db(fields=['active_connections'])
        UserStatus.objects.filter(pk=status.pk).update(online=status.active_connections > 0)


@database_sync_to_async
def persist_message(room, user, body, client_id):
    existing = Message.objects.filter(chat_room=room, sender=user, client_id=client_id).select_related('sender').first()
    if existing:
        return existing, True
    try:
        with transaction.atomic():
            message = Message.objects.create(chat_room=room, sender=user, message=body, client_id=client_id)
    except IntegrityError:
        message = Message.objects.get(chat_room=room, sender=user, client_id=client_id)
        return message, True
    return message, False


def message_payload(message):
    return {
        'id': str(message.server_id or message.pk),
        'client_id': message.client_id,
        'body': message.message,
        'sender': {'id': message.sender_id, 'username': message.sender.username, 'display_name': message.sender.get_full_name() or message.sender.username},
        'created_at': message.timestamp.isoformat(),
    }


class ChatRoomConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        slug = self.scope['url_route']['kwargs']['room_slug']
        self.chat_room = await get_authorized_room(slug, self.scope.get('user'))
        if self.chat_room is None:
            await self.close(code=4403)
            return
        self.room_group_name = f'chat_room_{self.chat_room.pk}'
        self.status_id = await open_presence(self.scope['user'])
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()
        await self.channel_layer.group_send(self.room_group_name, {'type': 'presence.event', 'user_id': self.scope['user'].pk, 'status': 'online'})

    async def receive_json(self, content, **kwargs):
        event = content.get('event')
        if event == 'message.create' or ('message' in content and not event):
            await self.create_message(content)
        elif event in {'typing.start', 'typing.stop'}:
            await self.channel_layer.group_send(self.room_group_name, {'type': 'typing.event', 'user_id': self.scope['user'].pk, 'is_typing': event.endswith('start')})
        elif event == 'read.update':
            await self.channel_layer.group_send(self.room_group_name, {'type': 'read.event', 'user_id': self.scope['user'].pk, 'message_id': content.get('message_id')})
        else:
            await self.send_json({'type': 'error', 'code': 'unknown_event', 'message': 'Unsupported event.'})

    async def create_message(self, content):
        body = str(content.get('body', content.get('message', ''))).strip()
        client_id = str(content.get('request_id') or content.get('client_id') or uuid.uuid4())
        if not body or len(body) > MAX_MESSAGE_LENGTH or len(client_id) > 64:
            await self.send_json({'type': 'error', 'request_id': client_id, 'code': 'invalid_payload', 'message': 'Message body or request ID is invalid.'})
            return
        message, deduplicated = await persist_message(self.chat_room, self.scope['user'], body, client_id)
        await self.channel_layer.group_send(self.room_group_name, {'type': 'message.event', 'message': message_payload(message), 'request_id': client_id, 'deduplicated': deduplicated})

    async def message_event(self, event):
        await self.send_json({'type': 'message.created', 'request_id': event['request_id'], 'deduplicated': event['deduplicated'], 'message': event['message']})

    async def presence_event(self, event):
        await self.send_json({'type': 'presence.changed', 'user_id': event['user_id'], 'status': event['status']})

    async def typing_event(self, event):
        await self.send_json({'type': 'typing.changed', 'user_id': event['user_id'], 'is_typing': event['is_typing']})

    async def read_event(self, event):
        await self.send_json({'type': 'message.read', 'user_id': event['user_id'], 'message_id': event['message_id']})

    async def disconnect(self, code):
        if hasattr(self, 'status_id'):
            await close_presence(self.status_id)
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

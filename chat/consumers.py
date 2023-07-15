import json
from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
from django.contrib.auth.models import User
from .models import Message, ChatRoom, UserStatus


class ChatRoomConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = f'chat_{self.room_name}'
        user_status, _ = await sync_to_async(UserStatus.objects.get_or_create)(user=self.scope['user'])
        user_status.online = True

        await sync_to_async(user_status.save)()

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        await self.accept()

    async def disconnect(self, code):
        user_status, _ = await sync_to_async(UserStatus.objects.get_or_create)(user=self.scope['user'])
        user_status.online = False
        await sync_to_async(user_status.save)()

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_status',
                'username': self.scope['user'].username,
                'online': False
            }
        )

        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        text_data_json = json.loads(text_data)
        message = text_data_json['message']

        sender = self.scope['user']
        room_name = self.scope['url_route']['kwargs']['room_name']
        try:
            online = await sync_to_async(UserStatus.objects.get)(user=sender)
        except UserStatus.DoesNotExist:
            online = None

        chat_room = await sync_to_async(ChatRoom.objects.get)(name=room_name)

        await sync_to_async(Message.objects.create)(
            message=message,
            sender=sender,
            chat_room=chat_room
        )

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_room_message',
                'message': message,
                'username': sender.username,
                'online': online.is_online() if online else False
            }
        )

    async def chat_room_message(self, event):
        message = event['message']
        username = event['username']
        online = event['online']

        await self.send(text_data=json.dumps({
            'message': message,
            'username': username,
            'online': online
        }))

    async def user_status(self, event):
        username = event['username']
        online = event['online']

        await self.send(text_data=json.dumps({
            'username': username,
            'online': online
        }))

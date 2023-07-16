import json
from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
from accounts.models import User
from .models import Message, ChatRoom, UserStatus


class ChatRoomConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = f'chat_{self.room_name}'
        
        user_status, _ = await sync_to_async(UserStatus.objects.get_or_create)(user=self.scope['user'])
        user_status.online = True

        self.chat_room = await sync_to_async(ChatRoom.objects.get)(name=self.room_name)
        sender = self.scope['user']
        # Add the sender to the seen_by field of all messages in the chat room
        messages = await sync_to_async(Message.objects.filter)(chat_room=self.chat_room)
        async for message in messages:
            await sync_to_async(message.seen_by.add)(sender)


        await sync_to_async(user_status.save)()

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        await self.accept()

   

    async def receive(self, text_data):
        text_data_json = json.loads(text_data)
        message = text_data_json['message']
        sender = self.scope['user']

        try:
            online = await sync_to_async(UserStatus.objects.get)(user=sender)
        except UserStatus.DoesNotExist:
            online = None

        self.chat_room = await sync_to_async(ChatRoom.objects.get)(name=self.room_name)

        message_obj = await sync_to_async(Message.objects.create)(chat_room=self.chat_room, sender=sender, message=message)
        
        
        seen_by_users = await sync_to_async(message_obj.seen_by.all)()
        seen_by_usernames = await sync_to_async(lambda: [user.username for user in seen_by_users])()

        # Notify the group about the new message
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_room_message',
                'message': str(message),
                'username': sender.username,
                'online': online.is_online() if online else False, 
                'seen_by': seen_by_usernames
            }
        )


    async def chat_room_message(self, event):
        message = event['message']
        username = event['username']
        online = event['online']
        seen_by = event['seen_by']

        await self.send(text_data=json.dumps({
            'message': message,
            'username': username,
            'online': online, 
            'seen_by': seen_by
        }))

    async def user_status(self, event):
        username = event['username']
        online = event['online']

        await self.send(text_data=json.dumps({
            'username': username,
            'online': online
        }))


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
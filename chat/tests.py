from asgiref.sync import async_to_sync
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.test import TestCase
from django.urls import re_path
from rest_framework.test import APIClient

from accounts.models import User

from .consumers import ChatRoomConsumer
from .models import ChatRoom, Message

socket_application = URLRouter([re_path(r'^ws/chat/(?P<room_slug>[-\w]+)/$', ChatRoomConsumer.as_asgi())])


class ChatApiTests(TestCase):
    def setUp(self):
        self.alice = User.objects.create_user(phone='09120000001', password='correct-password', first_name='Alice')
        self.bob = User.objects.create_user(phone='09120000002', password='correct-password', first_name='Bob')
        self.alice_room = ChatRoom.objects.create(name='Alice room')
        self.alice_room.users.add(self.alice, self.bob)
        self.private_room = ChatRoom.objects.create(name='Private room')
        self.private_room.users.add(self.alice)
        self.client = APIClient()
        self.client.force_authenticate(self.alice)

    def test_conversations_are_isolated_to_members(self):
        response = self.client.get('/api/v1/conversations/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual({item['slug'] for item in response.data['results']}, {'alice-room', 'private-room'})
        forbidden = self.client.get('/api/v1/conversations/unknown/messages/')
        self.assertEqual(forbidden.status_code, 404)

    def test_message_creation_is_idempotent(self):
        payload = {'body': 'hello', 'client_id': 'client-123'}
        first = self.client.post('/api/v1/conversations/alice-room/messages/', payload, format='json')
        second = self.client.post('/api/v1/conversations/alice-room/messages/', payload, format='json')
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.data['deduplicated'])
        self.assertEqual(Message.objects.filter(chat_room=self.alice_room, sender=self.alice).count(), 1)

    def test_message_length_and_cross_conversation_are_rejected(self):
        oversized = self.client.post('/api/v1/conversations/alice-room/messages/', {'body': 'x' * 4001, 'client_id': 'too-long'}, format='json')
        self.assertEqual(oversized.status_code, 400)
        not_a_member = APIClient()
        not_a_member.force_authenticate(self.bob)
        response = not_a_member.post('/api/v1/conversations/private-room/messages/', {'body': 'nope', 'client_id': 'blocked'}, format='json')
        self.assertEqual(response.status_code, 404)

    def test_history_is_cursor_paginated(self):
        for index in range(3):
            Message.objects.create(chat_room=self.alice_room, sender=self.alice, message=f'message-{index}', client_id=f'old-{index}')
        response = self.client.get('/api/v1/conversations/alice-room/messages/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 3)

    def test_only_sender_can_edit_or_delete(self):
        message = Message.objects.create(chat_room=self.alice_room, sender=self.alice, message='original', client_id='editable')
        edited = self.client.patch(f'/api/v1/messages/{message.server_id}/', {'body': 'updated'}, format='json')
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.data['message']['body'], 'updated')
        other = APIClient()
        other.force_authenticate(self.bob)
        self.assertEqual(other.delete(f'/api/v1/messages/{message.server_id}/').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/v1/messages/{message.server_id}/').status_code, 204)


class ChatWebsocketTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone='09120000003', password='correct-password')
        self.room = ChatRoom.objects.create(name='Socket room')
        self.room.users.add(self.user)

    def test_anonymous_socket_is_rejected(self):
        communicator = WebsocketCommunicator(socket_application, f'/ws/chat/{self.room.slug}/')
        connected, code = async_to_sync(communicator.connect)()
        self.assertFalse(connected)
        self.assertEqual(code, 4403)

    def test_member_can_create_a_message(self):
        async def scenario():
            communicator = WebsocketCommunicator(socket_application, f'/ws/chat/{self.room.slug}/')
            communicator.scope['user'] = self.user
            connected, _ = await communicator.connect()
            self.assertTrue(connected)
            await communicator.receive_json_from()
            await communicator.send_json_to({'event': 'message.create', 'request_id': 'socket-1', 'body': 'live hello'})
            event = await communicator.receive_json_from()
            await communicator.disconnect()
            return event

        event = async_to_sync(scenario)()
        self.assertEqual(event['type'], 'message.created')
        self.assertEqual(event['message']['body'], 'live hello')
        self.assertEqual(Message.objects.filter(chat_room=self.room).count(), 1)

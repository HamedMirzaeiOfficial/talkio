import asyncio

import pytest
from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import Client

from django_realtime_chat.routing import chat_websocket_application, websocket_urlpatterns
from django_realtime_chat.services import conversations as conv_svc
from django_realtime_chat.services import messages as msg_svc
from django_realtime_chat.ws.tickets import issue_ticket

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]


class InjectUser:
    """Test middleware: authenticate the socket as a given user."""

    def __init__(self, inner, user):
        self.inner, self.user = inner, user

    async def __call__(self, scope, receive, send):
        return await self.inner({**scope, "user": self.user}, receive, send)


def app_for(user):
    return InjectUser(URLRouter(websocket_urlpatterns), user)


async def connect(user, path="/ws/chat/v1/"):
    comm = WebsocketCommunicator(app_for(user), path)
    connected, _ = await comm.connect()
    assert connected
    ready = await comm.receive_json_from()
    assert ready["type"] == "connection.ready"
    return comm, ready


async def next_of(comm, event_type, timeout=1, where=lambda e: True):
    while True:
        event = await comm.receive_json_from(timeout=timeout)
        if event["type"] == event_type and where(event):
            return event


async def none_of(comm, event_type, timeout=0.3):
    """Assert no event of this type arrives (other event types are ignored)."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        # receive_nothing never cancels the application (a timed-out receive would).
        if await comm.receive_nothing(timeout=0.05):
            continue
        event = await comm.receive_json_from()
        assert event["type"] != event_type, event
    return True


@database_sync_to_async
def users(*names):
    model = get_user_model()
    return [model.objects.create_user(username=n, password="pw", first_name=n.title()) for n in names]


@database_sync_to_async
def make_group(owner, members, title="Room"):
    return conv_svc.create_group(owner, title=title, member_ids=[m.pk for m in members])


async def test_anonymous_connection_is_closed_with_4401():
    from django.contrib.auth.models import AnonymousUser

    comm = WebsocketCommunicator(app_for(AnonymousUser()), "/ws/chat/v1/")
    connected, _ = await comm.connect()
    assert connected
    error = await comm.receive_json_from()
    assert error["code"] == "not_authenticated"
    assert (await comm.receive_output())["code"] == 4401


async def test_ready_lists_conversations_and_message_send_acks_and_broadcasts():
    alice, bob = await users("alice", "bob")
    room = await make_group(alice, [bob])
    a, ready = await connect(alice)
    b, _ = await connect(bob)
    assert ready["conversation_ids"] == [str(room.pk)]
    await a.send_json_to(
        {
            "type": "message.send",
            "request_id": "r1",
            "conversation_id": str(room.pk),
            "client_id": "c1",
            "body": "hi",
        }
    )
    ack = await next_of(a, "ack")
    assert ack["request_id"] == "r1" and ack["data"]["message"]["seq"] == 1
    created = await next_of(b, "message.created")
    assert created["message"]["body"] == "hi" and created["conversation_id"] == str(room.pk)
    # Retry with the same client_id: acked as duplicate, not broadcast again.
    await a.send_json_to(
        {
            "type": "message.send",
            "request_id": "r2",
            "conversation_id": str(room.pk),
            "client_id": "c1",
            "body": "hi",
        }
    )
    dup = await next_of(a, "ack")
    assert dup["data"]["deduplicated"] is True
    assert await none_of(b, "message.created")
    await a.disconnect()
    await b.disconnect()


async def test_rest_writes_reach_sockets():
    alice, bob = await users("alice", "bob")
    room = await make_group(alice, [bob])
    b, _ = await connect(bob)
    message, _ = await database_sync_to_async(msg_svc.send_message)(alice, room.pk, body="from http")
    assert (await next_of(b, "message.created"))["message"]["id"] == str(message.pk)
    await database_sync_to_async(msg_svc.edit_message)(alice, message.pk, "edited")
    assert (await next_of(b, "message.updated"))["message"]["body"] == "edited"
    await database_sync_to_async(msg_svc.toggle_reaction)(bob, message.pk, "👍")
    assert (await next_of(b, "reaction.updated"))["reactions"][0]["count"] == 1
    await database_sync_to_async(msg_svc.delete_message)(alice, message.pk)
    assert (await next_of(b, "message.deleted"))["message"]["is_deleted"] is True
    await database_sync_to_async(conv_svc.mark_read)(alice, room.pk, 1)
    await b.disconnect()


async def test_cannot_send_to_foreign_conversation():
    alice, bob, mallory = await users("alice", "bob", "mallory")
    room = await make_group(alice, [bob])
    m, _ = await connect(mallory)
    await m.send_json_to(
        {"type": "message.send", "request_id": "x", "conversation_id": str(room.pk), "body": "spam"}
    )
    error = await next_of(m, "error")
    assert error["code"] == "not_found" and error["request_id"] == "x"
    await m.disconnect()


async def test_scoped_endpoint_rejects_non_members():
    alice, bob, mallory = await users("alice", "bob", "mallory")
    room = await make_group(alice, [bob])
    comm = WebsocketCommunicator(app_for(mallory), f"/ws/chat/v1/conversations/{room.pk}/")
    await comm.connect()
    assert (await comm.receive_json_from())["code"] == "not_found"
    assert (await comm.receive_output())["code"] == 4404
    ok, ready = await connect(bob, f"/ws/chat/v1/conversations/{room.pk}/")
    assert ready["conversation_ids"] == [str(room.pk)]
    await ok.disconnect()


async def test_typing_is_relayed_to_others_only_and_throttled():
    alice, bob = await users("alice", "bob")
    room = await make_group(alice, [bob])
    a, _ = await connect(alice)
    b, _ = await connect(bob)
    for _ in range(3):
        await a.send_json_to({"type": "typing.start", "conversation_id": str(room.pk)})
    typing = await next_of(b, "typing.updated")
    assert typing["is_typing"] is True and typing["user_id"] == alice.pk and typing["expires_in"] > 0
    await a.send_json_to({"type": "typing.stop", "conversation_id": str(room.pk)})
    assert (await next_of(b, "typing.updated"))["is_typing"] is False
    assert await none_of(a, "typing.updated")  # sender never receives its own typing
    await a.disconnect()
    await b.disconnect()


async def test_presence_handles_multiple_devices():
    alice, bob = await users("alice", "bob")
    await make_group(alice, [bob])
    b, _ = await connect(bob)
    phone, _ = await connect(alice)
    is_alice = lambda e: e["user_id"] == alice.pk  # noqa: E731
    online = await next_of(b, "presence.updated", where=is_alice)
    assert online["user_id"] == alice.pk and online["online"] is True
    laptop, _ = await connect(alice)
    await phone.disconnect()
    # One device is still connected: no offline event.
    assert await none_of(b, "presence.updated")
    await laptop.disconnect()
    offline = await next_of(b, "presence.updated", where=is_alice)
    assert offline["online"] is False and offline["last_seen_at"]
    await b.disconnect()


async def test_membership_changes_update_subscriptions():
    alice, bob, carol = await users("alice", "bob", "carol")
    room = await make_group(alice, [bob])
    c, ready = await connect(carol)
    assert ready["conversation_ids"] == []
    await database_sync_to_async(conv_svc.add_members)(alice, room.pk, [carol.pk])
    updated = await next_of(c, "conversation.updated")
    assert updated["conversation"]["id"] == str(room.pk)
    await database_sync_to_async(msg_svc.send_message)(alice, room.pk, body="welcome")
    assert (await next_of(c, "message.created"))["message"]["body"] == "welcome"
    await database_sync_to_async(conv_svc.remove_member)(alice, room.pk, carol.pk)
    assert (await next_of(c, "conversation.removed"))["conversation_id"] == str(room.pk)
    await database_sync_to_async(msg_svc.send_message)(alice, room.pk, body="after removal")
    assert await none_of(c, "message.created")
    await c.disconnect()


async def test_read_mark_over_socket_and_ping():
    alice, bob = await users("alice", "bob")
    room = await make_group(alice, [bob])
    await database_sync_to_async(msg_svc.send_message)(alice, room.pk, body="1")
    b, _ = await connect(bob)
    a, _ = await connect(alice)
    await b.send_json_to({"type": "read.mark", "request_id": "rd", "conversation_id": str(room.pk), "seq": 1})
    assert (await next_of(b, "ack"))["data"]["last_read_seq"] == 1
    receipt = await next_of(a, "read.updated")
    assert receipt["user_id"] == bob.pk and receipt["last_read_seq"] == 1
    await b.send_json_to({"type": "ping", "request_id": "p"})
    assert (await next_of(b, "pong"))["request_id"] == "p"
    await a.disconnect()
    await b.disconnect()


async def test_invalid_frames_and_rate_limits(settings):
    settings.CHAT_RATE_LIMITS = {"ws_other": "2/10s"}
    (alice,) = await users("alice")
    a, _ = await connect(alice)
    await a.send_to(text_data="not json")
    assert (await next_of(a, "error"))["code"] == "invalid_event"
    await a.send_json_to({"type": "nope"})
    assert (await next_of(a, "error"))["code"] == "unknown_event"
    for _ in range(3):
        await a.send_json_to({"type": "ping"})
    await next_of(a, "pong")
    await next_of(a, "pong")
    limited = await next_of(a, "error")
    assert limited["code"] == "rate_limited" and limited["details"]["retry_after"] > 0
    await a.disconnect()


@database_sync_to_async
def session_cookie(user):
    client = Client()
    client.force_login(user)
    return client.cookies["sessionid"].value


async def test_session_auth_and_origin_validation():
    (alice,) = await users("alice")
    cookie = await session_cookie(alice)
    app = chat_websocket_application()
    good = WebsocketCommunicator(
        app,
        "/ws/chat/v1/",
        headers=[(b"cookie", f"sessionid={cookie}".encode()), (b"origin", b"http://testserver")],
    )
    connected, _ = await good.connect()
    assert connected and (await good.receive_json_from())["type"] == "connection.ready"
    await good.disconnect()
    evil = WebsocketCommunicator(
        app,
        "/ws/chat/v1/",
        headers=[(b"cookie", f"sessionid={cookie}".encode()), (b"origin", b"https://evil.example")],
    )
    connected, _ = await evil.connect()
    assert not connected


async def test_ticket_auth_is_single_use():
    (alice,) = await users("alice")
    ticket = await database_sync_to_async(issue_ticket)(alice)
    app = chat_websocket_application(allowed_origins=["https://host.example"])
    headers = [(b"origin", b"https://host.example")]
    first = WebsocketCommunicator(app, f"/ws/chat/v1/?ticket={ticket}", headers=headers)
    await first.connect()
    assert (await first.receive_json_from())["user"]["username"] == "alice"
    await first.disconnect()
    replay = WebsocketCommunicator(app, f"/ws/chat/v1/?ticket={ticket}", headers=headers)
    await replay.connect()
    assert (await replay.receive_json_from())["code"] == "not_authenticated"
    forged = WebsocketCommunicator(app, "/ws/chat/v1/?ticket=forged", headers=headers)
    await forged.connect()
    assert (await forged.receive_json_from())["code"] == "not_authenticated"

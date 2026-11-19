from django.core.management import call_command
from django.utils import timezone
from django_realtime_chat.models import Conversation, Membership, Message, Reaction

from chat import models as legacy


def test_import_legacy_chat_is_idempotent(alice, bob):
    room = legacy.ChatRoom.objects.create(name="Old room", kind="group")
    room.users.add(alice, bob)
    first = legacy.Message.objects.create(chat_room=room, sender=alice, message="first", client_id="a")
    second = legacy.Message.objects.create(
        chat_room=room, sender=bob, message="second", client_id="b", edited_at=timezone.now()
    )
    legacy.Message.objects.create(chat_room=room, sender=bob, message="gone", deleted_at=timezone.now())
    legacy.Message.objects.filter(pk=second.pk).update(forwarded_from=first)
    legacy.MessageReaction.objects.create(message=first, user=bob, emoji="👍")
    direct = legacy.ChatRoom.objects.create(name="dm", kind="direct")
    direct.users.add(alice, bob)

    call_command("import_legacy_chat")
    call_command("import_legacy_chat")  # second run is a no-op

    assert Conversation.objects.count() == 2
    conv = Conversation.objects.get(kind="group")
    assert conv.title == "Old room" and conv.last_seq == 3
    rows = list(Message.objects.filter(conversation=conv).order_by("seq"))
    assert [m.body for m in rows] == ["first", "second", ""]
    assert rows[0].pk == first.server_id
    assert rows[1].forwarded_from_id == rows[0].pk and rows[1].edited_at
    assert rows[2].deleted_at is not None
    assert Reaction.objects.filter(message=rows[0], user=bob).exists()
    assert Membership.objects.get(conversation=conv, user=alice).role == "owner"
    assert Conversation.objects.get(kind="direct").direct_key == f"{alice.pk}:{bob.pk}"
    # Legacy data is untouched.
    assert legacy.Message.objects.count() == 3


def test_seed_demo_is_repeatable(db):
    call_command("seed_demo")
    call_command("seed_demo")
    assert Conversation.objects.filter(kind="group").count() == 2
    assert Conversation.objects.filter(kind="direct").count() == 2
    assert Message.objects.filter(body__contains="سلام").exists()


def test_seed_demo_refuses_without_debug(db, settings):
    import pytest
    from django.core.management.base import CommandError

    settings.DEBUG = False
    with pytest.raises(CommandError):
        call_command("seed_demo")

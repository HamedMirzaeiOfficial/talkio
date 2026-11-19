"""Real concurrency on PostgreSQL (skipped on SQLite, which serializes all writers)."""

import threading

import pytest
from django.contrib.auth import get_user_model
from django.db import connection

from django_realtime_chat.models import Conversation, Membership, Message
from django_realtime_chat.services import conversations as conv_svc
from django_realtime_chat.services import messages as msg_svc

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _postgres_only():
    if connection.vendor != "postgresql":
        pytest.skip("requires PostgreSQL")


def run_parallel(*targets):
    errors = []
    barrier = threading.Barrier(len(targets))

    def wrap(fn):
        def inner():
            try:
                barrier.wait()
                fn()
            except Exception as exc:  # collected and asserted below
                errors.append(exc)
            finally:
                connection.close()

        return inner

    threads = [threading.Thread(target=wrap(t)) for t in targets]
    [t.start() for t in threads]
    [t.join() for t in threads]
    return errors


def users(n):
    model = get_user_model()
    return [model.objects.create_user(username=f"c{i}", password="x") for i in range(n)]


def test_concurrent_direct_creation_yields_one_conversation():
    a, b = users(2)
    results = []
    errors = run_parallel(
        *[lambda: results.append(conv_svc.start_direct(a, b.pk)[0].pk) for _ in range(4)],
        *[lambda: results.append(conv_svc.start_direct(b, a.pk)[0].pk) for _ in range(4)],
    )
    assert errors == []
    assert len(set(results)) == 1
    assert Conversation.objects.filter(kind="direct").count() == 1


def test_concurrent_add_of_the_same_member_is_safe():
    owner, admin, target = users(3)
    group = conv_svc.create_group(owner, title="g", member_ids=[admin.pk])
    conv_svc.change_role(owner, group.pk, admin.pk, "admin")
    errors = run_parallel(
        *[lambda: conv_svc.add_members(owner, group.pk, [target.pk]) for _ in range(3)],
        *[lambda: conv_svc.add_members(admin, group.pk, [target.pk]) for _ in range(3)],
    )
    assert [e for e in errors if e.__class__.__name__ != "ValidationFailed"] == []
    assert Membership.objects.filter(conversation=group, user=target).count() == 1


def test_member_limit_holds_under_concurrency(settings):
    settings.CHAT_MAX_GROUP_MEMBERS = 3
    owner, *others = users(6)
    group = conv_svc.create_group(owner, title="g", member_ids=[others[0].pk])
    run_parallel(*[lambda u=u: conv_svc.add_members(owner, group.pk, [u.pk]) for u in others[1:]])
    assert Membership.objects.filter(conversation=group, left_at__isnull=True).count() <= 3


def test_many_concurrent_sends_and_retries_stay_gap_free():
    people = users(6)
    group = conv_svc.create_group(people[0], title="race", member_ids=[p.pk for p in people[1:]])

    def sender(user):
        def go():
            for i in range(10):
                msg_svc.send_message(user, group.pk, body=f"{i}", client_id=f"{user.pk}-{i}")
                msg_svc.send_message(user, group.pk, body=f"{i}", client_id=f"{user.pk}-{i}")  # retry

        return go

    assert run_parallel(*[sender(p) for p in people]) == []
    seqs = list(Message.objects.filter(conversation=group).order_by("seq").values_list("seq", flat=True))
    assert seqs == list(range(1, 61))
    group.refresh_from_db()
    assert group.last_seq == 60

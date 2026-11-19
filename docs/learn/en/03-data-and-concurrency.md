# Chapter 3 — Data, transactions and concurrency

**English** · [فارسی](../03-data-and-concurrency.md)

Files for this chapter: `models.py`, `services/messages.py`, `services/conversations.py`, `events.py`, `tests/test_concurrency.py`

This is the most important backend chapter. Most hard bugs in chat systems come from concurrency: two requests at the same moment.

## 1. Database constraints, the last line of defense

Application code can check "is there a private conversation between A and B?" and create one if not. But between the "check" and the "create" there are a few milliseconds. If two requests arrive at the same time, both see "no" and both create one. This pattern is called a **check-then-act race**.

The only reliable fix is a **unique constraint in the database**:

```python
direct_key = models.CharField(max_length=200, null=True, unique=True)   # "3:17"
```

Now the second request gets an `IntegrityError` on `INSERT`, and the code handles it like this (`start_direct`):

```python
try:
    with transaction.atomic():
        conv = Conversation.objects.create(kind="direct", direct_key=key, ...)
        ...
except IntegrityError:
    return Conversation.objects.get(direct_key=key), False   # return the race's winner
```

**The lesson:** checks in code are for a good user experience (a readable error message); database constraints are for correctness. You need both.

The project's other constraints: `unique(conversation, seq)`, `unique(conversation, sender, client_id)`, `unique(conversation, user)` for memberships, `unique(message, user, emoji)` for reactions.

## 2. Gap-free sequence numbers (`seq`)

### The problem

The old code paginated by `timestamp`. Two messages with the same time? One gets lost or duplicated at a page boundary. And after a dropped connection, a client could not tell whether it had missed a message.

### The solution

Every message in every conversation gets a consecutive number: 1, 2, 3 and so on. If a client has seen message 7 and message 10 arrives now, it knows it has not seen 8 and 9.

### Implementation (`_create`)

```python
with transaction.atomic():
    Conversation.objects.filter(pk=conv.pk).update(last_seq=F("last_seq") + 1, ...)
    seq = Conversation.objects.values_list("last_seq", flat=True).get(pk=conv.pk)
    message = Message.objects.create(conversation=conv, seq=seq, ...)
```

Why does it work? In PostgreSQL, an `UPDATE` on a row **locks that row until the end of the transaction**. A second transaction updating the same conversation waits until the first commits or rolls back, and then sees the new value. So no two messages ever get the same `seq`.

**Why `F("last_seq") + 1`?** If you read the value in Python, add one and save (`conv.last_seq += 1; conv.save()`), two requests both read 5 and both write 6. That is called a **lost update**. The `F()` expression hands the calculation to the database itself and is atomic.

**Why are there no gaps?** If an error happens after `seq` is incremented (an invalid attachment, say), the whole transaction rolls back, increment included. The test `test_failed_send_rolls_back_sequence` checks exactly that.

**The cost:** sends in *one* conversation run one after another (not across the whole system). That is acceptable for chat, and it is documented in [ADR 0003](../../architecture/decisions/0003-per-conversation-sequence-numbers.md).

### Counting unread messages

With `seq`, "read" is one number per member (`Membership.last_read_seq`), not a big table recording who saw each message. The unread count is a range count:

```
others' non-deleted messages with seq > last_read_seq
```

`serializers.annotate_for_viewer` computes this count as a **subquery** inside the conversation list query, so 50 conversations do not mean 50 separate queries (the **N+1** problem).

Updating the marker is atomic without a transaction too:

```python
Membership.objects.filter(pk=..., last_read_seq__lt=seq).update(last_read_seq=seq)
```

The condition `last_read_seq__lt=seq` guarantees the marker never moves back, even if two requests arrive in reverse order. This pattern has a name: a **monotonic update**.

## 3. Idempotency: safe repetition

The network is not reliable. A client sends a message and no response arrives. Did the server get the message? It cannot know. If it sends again, the message may be duplicated; if it does not, the message may be lost.

The solution: the client creates a unique id for each message (`client_id`, a UUID) and sends the same one in **every attempt**. The server:

1. First checks whether a message with this `(conversation, sender, client_id)` exists. If so, it returns that one (`created=False`, no new number is consumed, the event is not broadcast again).
2. If two attempts arrive at exactly the same time, the unique constraint rejects one with `IntegrityError` and the code returns the "winner".

This is called **at-least-once delivery + idempotent writes**. The system does not claim "exactly-once", which is practically impossible over a real network. Instead it guarantees that repetition has no repeated effect. ([ADR 0002](../../architecture/decisions/0002-at-least-once-idempotent-writes.md))

## 4. `transaction.on_commit`

```python
events.to_conversation(conv.pk, "message.created", {...})
# inside: transaction.on_commit(lambda: _send(group, event))
```

Why not send the event immediately? Because if the transaction later rolls back, clients have seen a message that does not exist in the database (a **phantom event**). `on_commit` runs the function only after a successful commit.

**A trap in tests:** `TestCase` wraps the whole test in a transaction that never commits, so `on_commit` callbacks never run. You have two options: `django_capture_on_commit_callbacks(execute=True)` or `@pytest.mark.django_db(transaction=True)`. The WebSocket tests use the second.

## 5. `SELECT … FOR UPDATE`

When you want to "read, decide, write" without anyone changing the data in the middle, lock the row when you read it:

```python
attachments = Attachment.objects.select_for_update().filter(pk__in=ids, uploaded_by=user, message__isnull=True)
```

Here (`_bind_attachments`) it guarantees that one pending file is never attached to two messages at the same time.

### An interesting discovery in this project

`get_membership(for_update=True)` combines `select_related("conversation")` with `select_for_update()` **without** `of=`. In PostgreSQL this locks both the membership row and the joined conversation row. I guessed that two admins adding the same member at the same time had a race. A real test on Postgres (`test_concurrent_add_of_the_same_member_is_safe`) showed **there is no race**, because that implicit lock serializes the operation. A twofold lesson:

1. **Check guesses about concurrency with a real test.** The guess "there is a bug" can be wrong, just like the guess "there is no bug".
2. **Document and test** the behavior the code relies on (there is a comment and a test in the project), so nobody unknowingly breaks it by adding `of=("self",)`.

## 6. Soft delete and tombstones

A deleted message is not really deleted: its text is cleared and it gets a `deleted_at`. Why?

- The `seq`s stay consecutive (the client does not see a fake gap).
- Replies pointing to that message do not break ("this message was deleted").
- Every device receives `message.deleted` and replaces its local copy.

Files, however, are really deleted (privacy), after the commit and only if no other row points to the same file (a forward does not copy the file, it only references it).

## 7. Cursor-based pagination

Pagination with `OFFSET` has two problems: it is slow on big tables, and if a new message arrives in the middle, items shift. A **cursor** means "give me what comes after this point":

- Messages: `before=<seq>` and `after=<seq>`. `seq` is unique and stable, so the cursor is simple and exact.
- Conversations: the order is by `last_activity_at`, which is not unique, so the cursor is a `(time, id)` pair and the continuation condition is `activity < t OR (activity = t AND id < cursor_id)`.

A real bug turned up here: at first the cursor was raw `2026-11-19T10:00:00+00:00|uuid`, and the `+` turned into a space in the query string. The fix: **make the cursor opaque** (base64url). The client must not know the cursor's structure.

## Exercises

1. On a local PostgreSQL (chapter 10 explains the `pgserver` way), run `test_many_concurrent_sends_and_retries_stay_gap_free` with 20 threads. Then temporarily use `conv.last_seq += 1; conv.save()` instead of `F()` in `_create` and watch how the test breaks.
2. Explain why the idempotency fast path (looking up `client_id` before the transaction) is not enough on its own.
3. If a user who previously left a group is added again, what happens to their `last_read_seq`, and why? (Read `add_members`.)

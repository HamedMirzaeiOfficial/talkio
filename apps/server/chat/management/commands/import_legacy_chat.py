"""Copy data from the legacy `chat` tables into django_realtime_chat.

Idempotent: conversations get deterministic ids derived from the legacy room id and
already-imported rooms are skipped, so the command can be re-run safely. Legacy
tables are only read, never modified.
"""

from __future__ import annotations

import uuid

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.db import transaction
from django_realtime_chat.models import Attachment, Conversation, Membership, Message, Reaction

from chat import models as legacy

NAMESPACE = uuid.UUID("6f1c2d1e-8c55-4c6b-9a43-2c8b3f9d7a10")


def room_uuid(room_id: int) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, f"legacy-room:{room_id}")


class Command(BaseCommand):
    help = "Import legacy chat rooms, members, messages, reactions and attachments (read-only on legacy tables)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report what would be imported.")

    def handle(self, *args, dry_run: bool = False, **options):
        imported = skipped = messages = 0
        for room in legacy.ChatRoom.objects.prefetch_related("users").order_by("pk"):
            conv_id = room_uuid(room.pk)
            if Conversation.objects.filter(pk=conv_id).exists():
                skipped += 1
                continue
            if dry_run:
                imported += 1
                messages += legacy.Message.objects.filter(chat_room=room).count()
                continue
            messages += self.import_room(room, conv_id)
            imported += 1
        verb = "Would import" if dry_run else "Imported"
        self.stdout.write(
            self.style.SUCCESS(f"{verb} {imported} room(s), {messages} message(s); skipped {skipped} already imported.")
        )

    @transaction.atomic
    def import_room(self, room, conv_id) -> int:
        users = sorted(room.users.all(), key=lambda u: u.pk)
        is_direct = room.kind == "direct" and len(users) == 2
        conv = Conversation.objects.create(
            id=conv_id,
            kind=Conversation.Kind.DIRECT if is_direct else Conversation.Kind.GROUP,
            title="" if is_direct else room.name[:120],
            direct_key=f"{users[0].pk}:{users[1].pk}" if is_direct else None,
            created_at=room.created_at,
        )
        if is_direct and Conversation.objects.filter(direct_key=conv.direct_key).exclude(pk=conv.pk).exists():
            raise RuntimeError(f"Room {room.pk}: a direct conversation for these users already exists.")
        for index, user in enumerate(users):
            role = Membership.Role.OWNER if (index == 0 and not is_direct) else Membership.Role.MEMBER
            Membership.objects.create(conversation=conv, user=user, role=role, joined_at=room.created_at)

        id_map: dict[int, uuid.UUID] = {}
        rows = list(legacy.Message.objects.filter(chat_room=room).order_by("timestamp", "pk"))
        last = None
        for seq, row in enumerate(rows, start=1):
            message = Message.objects.create(
                id=row.server_id or uuid.uuid5(NAMESPACE, f"legacy-message:{row.pk}"),
                conversation=conv,
                sender_id=row.sender_id,
                seq=seq,
                client_id=(row.client_id or f"legacy-{row.pk}")[:64],
                body="" if row.deleted_at else row.message,
                created_at=row.timestamp,
                edited_at=row.edited_at,
                deleted_at=row.deleted_at,
                pinned_at=row.pinned_at,
                pinned_by_id=row.pinned_by_id,
            )
            id_map[row.pk] = message.pk
            last = message
            for reaction in legacy.MessageReaction.objects.filter(message=row):
                Reaction.objects.get_or_create(message=message, user_id=reaction.user_id, emoji=reaction.emoji)
            for item in legacy.Attachment.objects.filter(message=row):
                if not item.file:
                    continue
                with item.file.open("rb") as handle:
                    data = handle.read()
                attachment = Attachment(
                    conversation=conv,
                    message=message,
                    uploaded_by_id=item.uploaded_by_id,
                    original_name=item.original_name[:255],
                    content_type=item.content_type,
                    size=item.size,
                )
                attachment.file.save(item.original_name, ContentFile(data), save=True)
        for row in rows:
            if row.forwarded_from_id and row.forwarded_from_id in id_map:
                Message.objects.filter(pk=id_map[row.pk]).update(forwarded_from_id=id_map[row.forwarded_from_id])
        if last is not None:
            Conversation.objects.filter(pk=conv.pk).update(
                last_seq=last.seq, last_message_at=last.created_at, last_activity_at=last.created_at
            )
            # Imported history counts as read; legacy read state was never recorded.
            Membership.objects.filter(conversation=conv).update(last_read_seq=last.seq)
        return len(rows)

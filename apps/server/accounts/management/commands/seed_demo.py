"""Create demo users and conversations for local development.

Refuses to run with DEBUG off unless --force is given. Never run against production.
"""

from __future__ import annotations

import io
import math
import struct
import wave
from datetime import timedelta

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django_realtime_chat.models import Conversation, Message, Sticker, StickerPack
from django_realtime_chat.services.attachments import upload_attachment
from django_realtime_chat.services.conversations import create_group, start_direct
from django_realtime_chat.services.messages import send_message, toggle_reaction

from accounts.models import User

PEOPLE = [
    ("alice", "Alice Moreau"),
    ("bahram", "Bahram Karimi"),
    ("chen", "Chen Wei"),
    ("dana", "Dana Okafor"),
    ("elena", "Elena Rossi"),
    ("farnaz", "Farnaz Ahmadi"),
]

SCRIPT = {
    "Product design": [
        ("alice", "Morning! The new onboarding flow is ready for review."),
        ("chen", "Looks great. Could we tighten the spacing on step two?"),
        ("dana", "Agreed — and the empty state copy feels long."),
        ("alice", "Good catch. I'll trim it to one sentence."),
        ("farnaz", "سلام! نسخه فارسی متن‌ها را هم آماده کردم."),
        ("chen", "Perfect, RTL layout renders correctly on my side."),
    ],
    "Engineering": [
        ("bahram", "Deploy window is at 16:00 UTC today."),
        ("elena", "Migrations are backwards compatible, verified on staging."),
        ("bahram", "Thanks. I'll watch the error rate after the rollout."),
    ],
}
DIRECT = {
    "bahram": [
        ("bahram", "Hey Alice, do you have a minute for the API review?"),
        ("alice", "Sure — 10 minutes?"),
        ("bahram", "Works for me 👍"),
    ],
    "farnaz": [("farnaz", "فردا جلسه ساعت ۱۰ است."), ("alice", "Thanks Farnaz, see you there!")],
}


class Command(BaseCommand):
    help = "Seed demo users and conversations (development only)."

    def add_arguments(self, parser):
        parser.add_argument("--password", default="talkio-demo-2026", help="Password for all demo users.")
        parser.add_argument("--force", action="store_true", help="Allow running with DEBUG off.")

    @transaction.atomic
    def handle(self, *args, password: str, force: bool, **options):
        if not settings.DEBUG and not force:
            raise CommandError("Refusing to seed demo data with DEBUG off (use --force on a non-production DB).")
        users = {}
        for username, name in PEOPLE:
            first, _, last = name.partition(" ")
            user, created = User.objects.get_or_create(
                username=username, defaults={"first_name": first, "last_name": last, "email": f"{username}@example.com"}
            )
            if created:
                user.set_password(password)
                user.save()
            users[username] = user
        alice = users["alice"]
        if Conversation.objects.filter(title="Product design").exists():
            self.stdout.write("Demo conversations already exist; users ensured.")
            return
        base = timezone.now() - timedelta(hours=3)
        for title, lines in SCRIPT.items():
            members = [u.pk for name, u in users.items() if name != "alice"]
            conv = create_group(alice, title=title, member_ids=members, description=f"{title} team space")
            self._play(conv, lines, users, base)
        for peer, lines in DIRECT.items():
            conv, _ = start_direct(alice, users[peer].pk)
            self._play(conv, lines, users, base)
        design = Conversation.objects.get(title="Product design")
        first = Message.objects.filter(conversation=design).order_by("seq").first()
        for name in ("chen", "dana"):
            toggle_reaction(users[name], first.pk, "🎉")
        toggle_reaction(users["bahram"], first.pk, "👍")
        self._attach_mockup(alice, design, base)
        self._sticker_pack()
        self._voice_note(
            users["bahram"], Conversation.objects.get(direct_key__isnull=False, memberships__user=users["bahram"]), base
        )
        latest = Message.objects.filter(conversation=design).order_by("-seq").first()
        reply, _ = send_message(
            users["dana"],
            design.pk,
            body="Love it. Can we ship this on Thursday?",
            reply_to_id=latest.pk,
            client_id="seed-reply",
        )
        stamp = base + timedelta(minutes=60)
        Message.objects.filter(pk=reply.pk).update(created_at=stamp)
        Conversation.objects.filter(pk=design.pk).update(last_message_at=stamp, last_activity_at=stamp)
        self.stdout.write(self.style.SUCCESS(f"Seeded {len(users)} users. Log in as 'alice' / '{password}'."))

    def _attach_mockup(self, user, conv, base):
        """A generated PNG, uploaded through the same validated service as real uploads."""
        try:
            from PIL import Image, ImageDraw
        except ImportError:
            return

        image = Image.new("RGB", (960, 600), (24, 28, 40))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((40, 40, 300, 560), 24, fill=(33, 39, 54))
        draw.rounded_rectangle((330, 40, 920, 120), 20, fill=(79, 70, 229))
        for row in range(4):
            draw.rounded_rectangle((330, 150 + row * 100, 920, 230 + row * 100), 18, fill=(40, 47, 64))
            draw.rounded_rectangle((350, 170 + row * 100, 560, 190 + row * 100), 8, fill=(99, 102, 241))
        for row in range(6):
            draw.ellipse((64, 72 + row * 78, 112, 120 + row * 78), fill=(129, 140, 248))
            draw.rounded_rectangle((128, 84 + row * 78, 270, 100 + row * 78), 6, fill=(60, 68, 88))
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        upload = SimpleUploadedFile("onboarding-v3.png", buffer.getvalue(), content_type="image/png")
        attachment = upload_attachment(user, conv.pk, upload)
        message, _ = send_message(
            user,
            conv.pk,
            body="Final mockup for the new onboarding 👇",
            attachment_ids=[attachment.pk],
            client_id="seed-mockup",
        )
        Message.objects.filter(pk=message.pk).update(created_at=base + timedelta(minutes=50))

    def _sticker_pack(self):
        """A small generated pack so the sticker picker has content (staff add real packs in admin)."""
        try:
            from PIL import Image, ImageDraw
        except ImportError:
            return
        if StickerPack.objects.exists():
            return
        pack = StickerPack.objects.create(name="Talkio basics")
        faces = [
            ("😀", (250, 204, 21)),
            ("😍", (244, 114, 182)),
            ("😎", (56, 189, 248)),
            ("🥳", (167, 139, 250)),
            ("😴", (148, 163, 184)),
            ("😡", (248, 113, 113)),
            ("👍", (52, 211, 153)),
            ("🎉", (251, 146, 60)),
        ]
        for position, (emoji, color) in enumerate(faces):
            image = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
            draw = ImageDraw.Draw(image)
            draw.ellipse((16, 16, 240, 240), fill=color + (255,), outline=(255, 255, 255, 255), width=10)
            draw.ellipse((78, 88, 108, 128), fill=(30, 30, 40, 255))
            draw.ellipse((148, 88, 178, 128), fill=(30, 30, 40, 255))
            draw.arc((70, 110, 186, 200), start=20, end=160, fill=(30, 30, 40, 255), width=12)
            buffer = io.BytesIO()
            image.save(buffer, format="WEBP")
            sticker = Sticker(
                pack=pack, emoji=emoji, position=position, content_type="image/webp", width=256, height=256
            )
            sticker.file.save(f"{position}.webp", ContentFile(buffer.getvalue()), save=True)

    def _voice_note(self, user, conv, base):
        """A two-second generated tone, uploaded as a voice note through the validated service."""
        rate, seconds = 16000, 2.4
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(rate)
            frames = (
                int(9000 * math.sin(2 * math.pi * 220 * t / rate) * (0.4 + 0.6 * abs(math.sin(t / rate * 5))))
                for t in range(int(rate * seconds))
            )
            out.writeframes(b"".join(struct.pack("<h", f) for f in frames))
        waveform = [round(40 + 60 * abs(math.sin(i / 64 * seconds * 5))) for i in range(64)]
        upload = SimpleUploadedFile("voice.wav", buffer.getvalue(), content_type="audio/wav")
        attachment = upload_attachment(user, conv.pk, upload, voice=True, duration=seconds, waveform=waveform)
        message, _ = send_message(user, conv.pk, attachment_ids=[attachment.pk], client_id="seed-voice")
        stamp = base + timedelta(minutes=30)
        Message.objects.filter(pk=message.pk).update(created_at=stamp)
        Conversation.objects.filter(pk=conv.pk).update(last_message_at=stamp, last_activity_at=stamp)

    def _play(self, conv, lines, users, base):
        for index, (author, body) in enumerate(lines):
            message, _ = send_message(users[author], conv.pk, body=body, client_id=f"seed-{conv.pk.hex[:8]}-{index}")
            stamp = base + timedelta(minutes=7 * index)
            Message.objects.filter(pk=message.pk).update(created_at=stamp)
        Conversation.objects.filter(pk=conv.pk).update(last_message_at=stamp, last_activity_at=stamp)

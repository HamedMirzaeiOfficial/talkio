from datetime import timedelta

from django.core.management.base import BaseCommand

from django_realtime_chat.services.attachments import purge_stale_uploads


class Command(BaseCommand):
    help = "Delete attachments that were uploaded but never sent (default: older than 24 hours)."

    def add_arguments(self, parser):
        parser.add_argument("--hours", type=int, default=24)

    def handle(self, *args, hours: int, **options):
        removed = purge_stale_uploads(timedelta(hours=hours))
        self.stdout.write(self.style.SUCCESS(f"Removed {removed} stale upload(s)."))

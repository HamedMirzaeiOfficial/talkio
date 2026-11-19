from django.contrib.auth.models import Group, User
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create two teammates (ann/ben, password 'example-pass') for the integration demo."

    def handle(self, *args, **options):
        team, _ = Group.objects.get_or_create(name="sales")
        for name, first in (("ann", "Ann"), ("ben", "Ben")):
            user, created = User.objects.get_or_create(username=name, defaults={"first_name": first})
            if created:
                user.set_password("example-pass")
                user.save()
            user.groups.add(team)
        self.stdout.write(self.style.SUCCESS("Users ann / ben ready (password: example-pass)."))

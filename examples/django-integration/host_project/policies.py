"""Permission extension hook: people can only discover and message teammates.

A "team" is a django.contrib.auth Group the host already uses.
"""

from django.contrib.auth.models import Group

from django_realtime_chat.permissions import ChatPolicy


class TeamPolicy(ChatPolicy):
    def user_queryset(self, user):
        teams = Group.objects.filter(user=user)
        return super().user_queryset(user).filter(groups__in=teams).distinct()

    def can_create_group(self, user):
        return super().can_create_group(user) and user.groups.exists()

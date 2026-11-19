from django_realtime_chat.permissions import ChatPolicy


class NoBobPolicy(ChatPolicy):
    def user_queryset(self, user):
        return super().user_queryset(user).exclude(username="bob")

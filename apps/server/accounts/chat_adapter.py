"""How the standalone app exposes its users to the chat package."""

from django_realtime_chat.users import DefaultUserAdapter


class AccountsUserAdapter(DefaultUserAdapter):
    search_fields = ("username", "first_name", "last_name")

    def display_name(self, user):
        # Legacy rows store NULL names, so avoid AbstractUser.get_full_name() ("Alice None").
        full = " ".join(part for part in (user.first_name, user.last_name) if part).strip()
        return full or self.handle(user) or "Talkio user"

    def handle(self, user):
        # Legacy accounts used the phone number as username; never expose phone numbers.
        if not user.username or (user.phone and user.username == user.phone):
            return None
        return user.username

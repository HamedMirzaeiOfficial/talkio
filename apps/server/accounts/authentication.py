from django.contrib.auth.backends import ModelBackend

from .models import User


class CustomModelBackend(ModelBackend):
    """Authenticate with a username, an e-mail address or a phone number."""

    def authenticate(self, request, username=None, password=None, **kwargs):
        if not username or password is None:
            return None
        if "@" in username:
            lookup = {"email__iexact": username}
        elif username.isdigit():
            lookup = {"phone": username}
        else:
            lookup = {"username__iexact": username}
        user = User.objects.filter(**lookup).first()
        if user is None:
            # Run the hasher anyway so response time does not reveal whether the account exists.
            User().set_password(password)
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None

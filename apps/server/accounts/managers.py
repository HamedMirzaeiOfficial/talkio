from django.contrib.auth.models import BaseUserManager


class UserManager(BaseUserManager):
    """`phone` is the legacy USERNAME_FIELD; new accounts sign up with a username instead."""

    def create_user(self, phone=None, password=None, **extra_fields):
        username = extra_fields.pop("username", None)
        if not phone and not username:
            raise ValueError("Users must have a phone number or a username.")
        user = self.model(phone=phone or None, username=username or phone, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, phone, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("valid_phone", True)
        extra_fields.setdefault("valid_email", True)
        return self.create_user(phone, password, **extra_fields)

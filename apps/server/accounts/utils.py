import secrets
import string

_ALPHABET = string.ascii_lowercase + string.digits


def generate_new_verification_code() -> str:
    """Five-digit code (referenced by migration 0001; keep the name)."""
    return str(10000 + secrets.randbelow(90000))


def generate_username(length: int = 8) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))

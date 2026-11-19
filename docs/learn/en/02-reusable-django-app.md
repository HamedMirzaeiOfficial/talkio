# Chapter 2 — Building a reusable Django package

**English** · [فارسی](../02-reusable-django-app.md)

Files for this chapter: `packages/django-chat/pyproject.toml`, `src/django_realtime_chat/{apps,conf,checks,users,permissions,urls,routing}.py`

## 1. An "app inside a project" versus a "package"

An ordinary Django app can import anything from the project. A **package** cannot, because it does not know which project it will be installed in. The old code had `from accounts.models import User`; without the `accounts` app it did not work at all. The first step of building a package is cutting every such dependency.

## 2. A swappable user model

Django lets every project have its own user model (`AUTH_USER_MODEL`). The package must work with any of them:

```python
# models.py
sender = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="rtchat_messages")
```

and in the migration:

```python
dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
```

`swappable_dependency` tells Django "this migration depends on the first migration of whatever user model the project chose".

**The `related_name` lesson:** every `ForeignKey` creates a "reverse accessor" on the target model (`user.chat_messages`). If the package picks a plain name, it may clash with the accessor of another app in the host project. That is exactly what happened in this project: `chat_attachments` existed both in the package and in the old app, and `manage.py check` raised `fields.E304`. The fix: a dedicated `rtchat_` prefix. **A package must always prefix names in shared namespaces (accessors, tables, cache keys, group names).** Examples in the code: `rtchat:throttle:`, `rtchat:presence:`, `rtchat.c.` and `rtchat.u.`.

## 3. Showing a user without knowing their model: the Adapter

The package has to show a user's name and picture, but it does not know whether the user model has an `avatar` field, a `photo` field, or neither. The **Adapter** pattern solves this (`users.py`):

```python
class DefaultUserAdapter:
    def display_name(self, user): ...
    def handle(self, user): ...
    def avatar_url(self, user): ...
    def search(self, queryset, query): ...
```

The host writes a subclass and registers it with `CHAT_USER_ADAPTER`. A real example: `apps/server/accounts/chat_adapter.py`, which solves two problems of the old data. One: last names were `NULL`, and `get_full_name()` produced "Alice None". The other: old users had their phone number as the username, which must not be shown (privacy).

## 4. Extensible permissions: the Policy

Every "is this allowed?" decision lives in one class (`permissions.py::ChatPolicy`). The benefits:

- **One place for a security review.** No hunting for ifs across ten files.
- **Extensible without forking.** A real example in `examples/django-integration/host_project/policies.py`: only teammates can find each other.

```python
class TeamPolicy(ChatPolicy):
    def user_queryset(self, user):
        teams = Group.objects.filter(user=user)
        return super().user_queryset(user).filter(groups__in=teams).distinct()
```

A subtle point: `user_queryset` is used not only for search but also in `_resolve_users`; so someone you cannot find also cannot be added to a group by sending their id directly. **Authorization must be enforced on the write path, not only in the UI.**

## 5. Settings: sensible defaults plus validation

`conf.py` defines every setting with the `CHAT_` prefix and a `DEFAULTS` dictionary. Three design points:

1. **Lazy reads on every access** (`__getattr__`). If settings were copied once at import time, `override_settings` would not work in tests.
2. **Merging dictionaries.** A host can pass just `{"http_write": "60/m"}` and the other rate limits keep their defaults.
3. **System checks** (`checks.py`). Django runs these on `runserver`, `migrate` and `check --deploy`. A typo such as `CHAT_MAX_MESAGE_LENGTH` produces warning `W001` right away instead of being silently ignored. And if someone adds `image/svg+xml` to the allowed files, they get error `E007` (SVG can contain JavaScript).

**The lesson:** configuration errors must be **early and loud**. The worst bugs are settings that are silently ignored.

## 6. URLs with a namespace

```python
# urls.py
app_name = "realtime_chat"
```

The host decides where to mount the package (`/api/chat/v1/` or anywhere else). The package never hard-codes addresses; it builds them with `reverse("realtime_chat:attachment-download", args=[id])`. That is why file links are always right for the mount point.

## 7. A real trap: callable storage

```python
file = models.FileField(storage=attachment_storage, ...)
```

Django's documentation says `storage` may be a callable. What is said less often: the callable is called **once, when the models load**. So if the function returns `storages["..."]` directly, a later settings change (for example in a test) has no effect. A test revealed this: files were written to disk instead of the test's in-memory storage. The fix in `models.py` is a `LazyObject` that resets on the `setting_changed` signal.

## 8. Supporting several Django versions

The package is tested on Django 4.2 and 5.2 (both LTS): a separate venv with Django 4.2, DRF 3.14 and Channels 4.0 passes every test, and CI has a version matrix. For a package, **actually test the minimum version you claim.** A real example: Channels 4.0 needs `daphne` in `channels.testing`. That only showed up when testing the old version, and it was added to the `test` extras.

## Exercises

1. Add a new setting `CHAT_MAX_PINNED_MESSAGES`: a default in `DEFAULTS`, a check in `checks.py`, enforcement in `toggle_pin`, and a test.
2. Write a `ChatPolicy` that forbids non-`is_staff` users from sending messages in groups whose title starts with `[Announcement]`. Where do you test it?
3. Why is `get_policy()` cached with `lru_cache` on the **setting's value**, rather than in a plain global variable? (Hint: tests that change `CHAT_POLICY`.)

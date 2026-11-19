"""Integration signals sent after the database transaction commits.

Hosts can connect to these for notifications, analytics or search indexing.
"""

from django.dispatch import Signal

#: sender=Message class, kwargs: message, created_by
message_created = Signal()
#: kwargs: message, updated_by
message_updated = Signal()
#: kwargs: message, deleted_by
message_deleted = Signal()
#: kwargs: conversation, created_by
conversation_created = Signal()
#: kwargs: conversation, added_user_ids, removed_user_ids, changed_by
members_changed = Signal()

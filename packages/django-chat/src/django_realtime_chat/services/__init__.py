"""Business logic shared by the REST API and the WebSocket consumer.

Services are synchronous, enforce authorization through ``get_policy()`` and schedule
broadcasts with ``transaction.on_commit``. The WebSocket consumer calls them through
``database_sync_to_async``.
"""

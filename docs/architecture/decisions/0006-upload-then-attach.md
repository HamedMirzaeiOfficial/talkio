# ADR 0006: Upload first, attach in the message transaction

## Status

Accepted (2026-11-19)

## Context

The legacy API required an existing message before uploading a file, so a file message was two non-atomic requests and the client-declared content type was trusted.

## Decision

`POST /attachments/` stores a *pending* attachment bound to the uploader and a conversation, after detecting the type from the file's bytes and verifying images. `message.send` references `attachment_ids`; binding happens inside the message transaction with `SELECT … FOR UPDATE` and checks that each attachment is the sender's own, pending, and from the same conversation.

## Consequences

- Upload progress can be shown before the message exists; the message appears atomically with its files.
- Pending uploads are visible only to the uploader and limited per user; `chat_purge_uploads` removes abandoned ones.
- Files live in a configurable storage alias (`CHAT_ATTACHMENT_STORAGE`) that should not be publicly served; downloads go through an authorized view.

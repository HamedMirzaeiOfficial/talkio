from django.urls import path

from . import views

urlpatterns = [
    path("config/", views.ConfigView.as_view(), name="config"),
    path("ws-ticket/", views.SocketTicketView.as_view(), name="ws-ticket"),
    path("conversations/", views.ConversationListView.as_view(), name="conversation-list"),
    path(
        "conversations/<uuid:conversation_id>/",
        views.ConversationDetailView.as_view(),
        name="conversation-detail",
    ),
    path(
        "conversations/<uuid:conversation_id>/read/",
        views.ConversationReadView.as_view(),
        name="conversation-read",
    ),
    path("conversations/<uuid:conversation_id>/members/", views.MemberListView.as_view(), name="member-list"),
    path(
        "conversations/<uuid:conversation_id>/members/<str:user_id>/",
        views.MemberDetailView.as_view(),
        name="member-detail",
    ),
    path(
        "conversations/<uuid:conversation_id>/messages/", views.MessageListView.as_view(), name="message-list"
    ),
    path("messages/search/", views.MessageSearchView.as_view(), name="message-search"),
    path("messages/<uuid:message_id>/", views.MessageDetailView.as_view(), name="message-detail"),
    path(
        "messages/<uuid:message_id>/reactions/", views.MessageReactionView.as_view(), name="message-reactions"
    ),
    path("messages/<uuid:message_id>/pin/", views.MessagePinView.as_view(), name="message-pin"),
    path("messages/<uuid:message_id>/forward/", views.MessageForwardView.as_view(), name="message-forward"),
    path("stickers/", views.StickerPackListView.as_view(), name="sticker-packs"),
    path("stickers/<uuid:sticker_id>/file/", views.StickerFileView.as_view(), name="sticker-file"),
    path("users/search/", views.UserSearchView.as_view(), name="user-search"),
    path("users/<str:user_id>/", views.UserDetailView.as_view(), name="user-detail"),
    path("attachments/", views.AttachmentUploadView.as_view(), name="attachment-upload"),
    path("attachments/<uuid:attachment_id>/", views.AttachmentDetailView.as_view(), name="attachment-detail"),
    path(
        "attachments/<uuid:attachment_id>/download/",
        views.AttachmentDownloadView.as_view(),
        name="attachment-download",
    ),
]

from django.urls import path

from .api import (
    ConversationListView,
    UserDirectoryView,
    ConversationMessagesView,
    CsrfView,
    CurrentUserView,
    HealthView,
    ReadinessView,
    MessageDetailView,
    MessageReactionView,
    AttachmentDownloadView,
    AttachmentUploadView,
    SessionLoginView,
    SessionRegisterView,
    SessionLogoutView,
)

urlpatterns = [
    path('health/', HealthView.as_view(), name='health'),
    path('health/ready/', ReadinessView.as_view(), name='readiness'),
    path('auth/login/', SessionLoginView.as_view(), name='api-login'),
    path('auth/register/', SessionRegisterView.as_view(), name='api-register'),
    path('auth/csrf/', CsrfView.as_view(), name='api-csrf'),
    path('auth/logout/', SessionLogoutView.as_view(), name='api-logout'),
    path('auth/me/', CurrentUserView.as_view(), name='api-me'),
    path('conversations/', ConversationListView.as_view(), name='conversation-list'),
    path('users/', UserDirectoryView.as_view(), name='user-directory'),
    path('conversations/<slug:slug>/messages/', ConversationMessagesView.as_view(), name='conversation-messages'),
    path('messages/<uuid:server_id>/', MessageDetailView.as_view(), name='message-detail'),
    path('messages/<uuid:server_id>/reactions/', MessageReactionView.as_view(), name='message-reaction'),
    path('attachments/', AttachmentUploadView.as_view(), name='attachment-upload'),
    path('attachments/<int:attachment_id>/', AttachmentDownloadView.as_view(), name='attachment-download'),
]

from django.urls import path

from .api import (
    ConversationListView,
    ConversationMessagesView,
    CsrfView,
    CurrentUserView,
    HealthView,
    MessageDetailView,
    AttachmentDownloadView,
    AttachmentUploadView,
    SessionLoginView,
    SessionRegisterView,
    SessionLogoutView,
)

urlpatterns = [
    path('health/', HealthView.as_view(), name='health'),
    path('auth/login/', SessionLoginView.as_view(), name='api-login'),
    path('auth/register/', SessionRegisterView.as_view(), name='api-register'),
    path('auth/csrf/', CsrfView.as_view(), name='api-csrf'),
    path('auth/logout/', SessionLogoutView.as_view(), name='api-logout'),
    path('auth/me/', CurrentUserView.as_view(), name='api-me'),
    path('conversations/', ConversationListView.as_view(), name='conversation-list'),
    path('conversations/<slug:slug>/messages/', ConversationMessagesView.as_view(), name='conversation-messages'),
    path('messages/<uuid:server_id>/', MessageDetailView.as_view(), name='message-detail'),
    path('attachments/', AttachmentUploadView.as_view(), name='attachment-upload'),
    path('attachments/<int:attachment_id>/', AttachmentDownloadView.as_view(), name='attachment-download'),
]

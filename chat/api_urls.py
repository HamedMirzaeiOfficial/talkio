from django.urls import path

from .api import (
    ConversationListView,
    ConversationMessagesView,
    CsrfView,
    CurrentUserView,
    HealthView,
    SessionLoginView,
    SessionLogoutView,
)

urlpatterns = [
    path('health/', HealthView.as_view(), name='health'),
    path('auth/login/', SessionLoginView.as_view(), name='api-login'),
    path('auth/csrf/', CsrfView.as_view(), name='api-csrf'),
    path('auth/logout/', SessionLogoutView.as_view(), name='api-logout'),
    path('auth/me/', CurrentUserView.as_view(), name='api-me'),
    path('conversations/', ConversationListView.as_view(), name='conversation-list'),
    path('conversations/<slug:slug>/messages/', ConversationMessagesView.as_view(), name='conversation-messages'),
]

from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.contrib.auth.decorators import login_required
from django.urls import include, path
from django.views.generic import TemplateView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("login/", auth_views.LoginView.as_view(), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("", login_required(TemplateView.as_view(template_name="home.html")), name="home"),
    # 3) mount the API (the namespace is required)
    path("api/chat/v1/", include("django_realtime_chat.urls")),
]

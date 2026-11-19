import pytest
from django.test import Client

from accounts.models import User


@pytest.fixture
def staff(db):
    user = User.objects.create_user(username="staffer", password="pw-123456", is_staff=True)
    client = Client()
    client.force_login(user)
    return client


def test_docs_require_staff(db, alice):
    assert Client().get("/admin/docs/README.md").status_code == 302  # to admin login
    member = Client()
    member.force_login(alice)
    response = member.get("/admin/docs/README.md")
    assert response.status_code == 302 and "/admin/login/" in response["Location"]


def test_index_redirects_to_readme_and_renders(staff):
    assert staff.get("/admin/docs/")["Location"].endswith("/admin/docs/README.md")
    page = staff.get("/admin/docs/README.md")
    html = page.content.decode()
    assert page.status_code == 200
    assert "<h1" in html and "How to use" in html
    assert 'href="/admin/docs/docs/backend.md"' in html  # sidebar navigation
    assert 'class="table-wrap"' not in html  # wrapping happens client-side


def test_technical_docs_render_tables_code_and_mermaid(staff):
    html = staff.get("/admin/docs/docs/backend.md").content.decode()
    assert "<table>" in html
    assert '<pre class="mermaid">' in html
    assert 'id="4-services"' in html  # GitHub-compatible anchors for in-page links


def test_persian_learning_guide_is_rtl(staff):
    html = staff.get("/admin/docs/docs/learn/03-data-and-concurrency.md").content.decode()
    assert 'dir="rtl"' in html and 'lang="fa"' in html
    assert "راهنمای یادگیری" in html


@pytest.mark.parametrize(
    "path",
    [
        "../manage.py",
        "apps/server/core/settings.py",
        "docs/../apps/server/.env",
        "%2e%2e/%2e%2e/etc/passwd",
        ".env",
        "docs/missing.md",
    ],
)
def test_only_readme_and_docs_are_reachable(staff, path):
    assert staff.get(f"/admin/docs/{path}").status_code == 404


def test_images_are_served_safely(staff):
    png = staff.get("/admin/docs/docs/screenshots/login.png")
    assert png.status_code == 200 and png["Content-Type"] == "image/png"
    svg = staff.get("/admin/docs/docs/assets/logo.svg")
    assert svg["Content-Type"] == "image/svg+xml" and "default-src 'none'" in svg["Content-Security-Policy"]


def test_admin_has_documentation_link(staff):
    staff_user = User.objects.get(username="staffer")
    staff_user.is_superuser = True
    staff_user.save()
    assert 'href="/admin/docs/"' in staff.get("/admin/").content.decode()

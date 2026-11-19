"""Project documentation served inside the admin at /admin/docs/.

Renders README.md and every Markdown file under docs/ for staff users, with navigation,
a table of contents, syntax highlighting, Mermaid diagrams and right-to-left layout for
Persian pages. URLs mirror repository paths (``/admin/docs/docs/api/websocket.md``), so the
relative links inside the documents work unchanged. Only files below the repository's
``docs/`` folder plus ``README.md`` and ``README.fa.md`` are reachable; nothing else in the repository is.
"""

from __future__ import annotations

import mimetypes
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import markdown
from django.conf import settings
from django.contrib.admin.views.decorators import staff_member_required
from django.http import FileResponse, Http404, HttpRequest, HttpResponse
from django.shortcuts import redirect, render
from django.urls import path, reverse
from markdown.extensions.toc import slugify_unicode

ASSET_TYPES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
# Persian documents: the learning guide (except its English copy), docs/fa/ and README.fa.md.
RTL_PREFIXES = ("docs/learn/", "docs/fa/", "README.fa.md")
LTR_PREFIXES = ("docs/learn/en/",)
_LANG_LINK = re.compile(r"\[فارسی\]\([^)]*\)|<a [^>]*>فارسی</a>")
_STRONG_RTL = re.compile("[֐-ࣿיִ-﷿ﹰ-ﻼ]")


@dataclass(frozen=True)
class NavItem:
    path: str
    title: str


# Reading order for the sidebar. Files not listed appear under "Other".
SECTIONS: list[tuple[str, list[str]]] = [
    ("Overview", ["README.md", "docs/architecture/overview.md", "docs/architecture/target-architecture.md"]),
    ("Technical reference", ["docs/backend.md", "docs/frontend.md", "docs/design-system.md"]),
    ("API", ["docs/api/rest-api.md", "docs/api/websocket.md", "docs/api/migration-from-v1.md"]),
    ("Integration", ["docs/integration/django.md", "docs/integration/react.md"]),
    ("Operations", ["docs/deployment.md", "docs/security.md"]),
    ("History", ["docs/architecture/current-state.md"]),
]
LEARN_DIR = "docs/learn/"
LEARN_EN_DIR = "docs/learn/en/"
FA_DIR = "docs/fa/"
DECISIONS_DIR = "docs/architecture/decisions/"
# Pointer pages kept only for old links.
HIDDEN = {
    "docs/api/websocket-protocol.md",
    "docs/architecture/architecture.md",
    "docs/architecture/proposed-design.md",
    "docs/frontend-architecture.md",
}


def docs_root() -> Path:
    return Path(getattr(settings, "DOCS_ROOT", settings.REPO_ROOT)).resolve()


def resolve(relative: str) -> Path:
    """Map a URL path to a file, refusing anything outside README.md and docs/."""
    root = docs_root()
    candidate = (root / relative).resolve()
    allowed = candidate in (root / "README.md", root / "README.fa.md") or candidate.is_relative_to(root / "docs")
    if not allowed or not candidate.is_file():
        raise Http404("Document not found")
    return candidate


def _title_of(file: Path) -> str:
    for line in file.read_text(encoding="utf-8").splitlines():
        if line.startswith("# "):
            return line[2:].strip().replace("`", "")
        match = re.match(r"<h1[^>]*>(.*?)</h1>", line)
        if match:
            return match.group(1)
    return file.stem.replace("-", " ").title()


@lru_cache(maxsize=1)
def _navigation_cached(stamp: float) -> list[tuple[str, list[NavItem], bool]]:
    root = docs_root()
    files = {str(p.relative_to(root)) for p in (root / "docs").rglob("*.md")} | {"README.md"}
    if (root / "README.fa.md").exists():
        files.add("README.fa.md")
    seen: set[str] = set()
    groups: list[tuple[str, list[NavItem], bool]] = []
    for name, paths in SECTIONS:
        items = [NavItem(p, _title_of(root / p)) for p in paths if p in files]
        seen.update(p for p in paths)
        if items:
            groups.append((name, items, False))
    decisions = sorted(p for p in files if p.startswith(DECISIONS_DIR))
    groups.append(("Decisions (ADR)", [NavItem(p, _title_of(root / p)) for p in decisions], False))

    # Each guide's own index first, then chapters in order.
    def index_first(paths):
        return sorted(paths, key=lambda p: (not p.endswith("README.md"), p))

    learn_en = index_first(p for p in files if p.startswith(LEARN_EN_DIR))
    learn = index_first(p for p in files if p.startswith(LEARN_DIR) and p not in learn_en)
    persian = index_first(
        [*(p for p in files if p.startswith(FA_DIR)), *(["README.fa.md"] if "README.fa.md" in files else [])]
    )
    if learn_en:
        groups.append(("Learning guide (English)", [NavItem(p, _title_of(root / p)) for p in learn_en], False))
    groups.append(("راهنمای یادگیری", [NavItem(p, _title_of(root / p)) for p in learn], True))
    if persian:
        groups.append(("مستندات فارسی", [NavItem(p, _title_of(root / p)) for p in persian], True))
    seen.update(decisions + learn + learn_en + persian)
    other = sorted(p for p in files - seen - HIDDEN)
    if other:
        groups.append(("Other", [NavItem(p, _title_of(root / p)) for p in other], False))
    return groups


def navigation() -> list[tuple[str, list[NavItem], bool]]:
    # Cache keyed by the newest modification time, so edited docs show up without a restart.
    root = docs_root()
    stamp = max((p.stat().st_mtime for p in (root / "docs").rglob("*.md")), default=0.0)
    return _navigation_cached(stamp)


_MERMAID = re.compile(r'<pre><code class="language-mermaid">(.*?)</code></pre>', re.S)


def render_markdown(text: str) -> tuple[str, str]:
    md = markdown.Markdown(
        extensions=["extra", "sane_lists", "toc"],
        extension_configs={"toc": {"slugify": slugify_unicode, "permalink": "#", "toc_depth": "2-3"}},
        output_format="html",
    )
    html = md.convert(text)
    # Mermaid code fences become diagram containers rendered in the browser.
    html = _MERMAID.sub(lambda m: f'<pre class="mermaid">{m.group(1)}</pre>', html)
    return html, md.toc  # type: ignore[attr-defined]


@staff_member_required
def document(request: HttpRequest, doc_path: str = "README.md") -> HttpResponse:
    file = resolve(doc_path)
    if file.suffix.lower() in ASSET_TYPES:
        content_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        response = FileResponse(file.open("rb"), content_type=content_type)
        response["X-Content-Type-Options"] = "nosniff"
        if file.suffix.lower() == ".svg":
            response["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'"
        return response
    if file.suffix.lower() != ".md":
        raise Http404("Document not found")
    text = file.read_text(encoding="utf-8")
    body, toc = render_markdown(text)
    relative = str(file.relative_to(docs_root()))
    # The "English · فارسی" switch at the top of English pages must not make them right-to-left.
    sample = _LANG_LINK.sub("", text[:600])[:400]
    rtl = not relative.startswith(LTR_PREFIXES) and (
        relative.startswith(RTL_PREFIXES) or bool(_STRONG_RTL.search(sample))
    )
    return render(
        request,
        "docs/page.html",
        {
            "body": body,
            "toc": toc,
            "title": _title_of(file),
            "current": relative,
            "rtl": rtl,
            "groups": navigation(),
            "docs_base": reverse("docs-index"),
            "admin_url": reverse("admin:index"),
        },
    )


@staff_member_required
def index(request: HttpRequest) -> HttpResponse:
    return redirect("docs-page", doc_path="README.md")


urlpatterns = [
    path("", index, name="docs-index"),
    path("<path:doc_path>", document, name="docs-page"),
]

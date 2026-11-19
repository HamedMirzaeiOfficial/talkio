#!/usr/bin/env python3
"""Gettext catalogs for Talkio without the GNU gettext tools.

Django's makemessages/compilemessages need xgettext and msgfmt installed. This script does the same
three jobs with the standard library only, so contributors and CI need nothing extra:

    python scripts/i18n.py extract   # scan the code and add new msgids to every .po file
    python scripts/i18n.py compile   # write the binary .mo next to each .po
    python scripts/i18n.py check     # fail if a msgid has no translation or a .mo is stale

Strings are found with the `ast` module: the first literal argument of gettext(), gettext_lazy(), _()
and pgettext()/pgettext_lazy() (context + message). Catalogs:

    packages/django-chat/src/django_realtime_chat/locale/<lang>/LC_MESSAGES/django.po   (the reusable app)
    apps/server/locale/<lang>/LC_MESSAGES/django.po                                     (the Talkio server)
"""

from __future__ import annotations

import ast
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANGUAGES = ["fa"]
DOMAINS = {
    ROOT / "packages/django-chat/src/django_realtime_chat": ROOT
    / "packages/django-chat/src/django_realtime_chat/locale",
    ROOT / "apps/server": ROOT / "apps/server/locale",
}
SKIP = {"migrations", "tests", "__pycache__", "node_modules", ".venv", "locale"}
FUNCS = {"gettext", "gettext_lazy", "_", "ngettext", "pgettext", "pgettext_lazy"}

Key = tuple[str | None, str]  # (context, msgid)


def scan(source_dir: Path) -> dict[Key, str]:
    found: dict[Key, str] = {}
    for path in sorted(source_dir.rglob("*.py")):
        if SKIP & set(path.relative_to(source_dir).parts) or path.name.startswith("test"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not node.args:
                continue
            name = node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", "")
            if name not in FUNCS:
                continue
            args = [a.value if isinstance(a, ast.Constant) and isinstance(a.value, str) else None for a in node.args]
            key: Key | None = None
            if name.startswith("pgettext") and len(args) >= 2 and args[0] and args[1]:
                key = (args[0], args[1])
            elif not name.startswith("pgettext") and args[0]:
                key = (None, args[0])
            if key:
                found.setdefault(key, f"{path.relative_to(ROOT)}:{node.lineno}")
    return found


def _quote(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace('"', '\\"').replace("\t", "\\t")
    if "\n" not in escaped:
        return f'"{escaped}"'
    lines = escaped.split("\n")
    parts = [f'"{line}\\n"' for line in lines[:-1]] + ([f'"{lines[-1]}"'] if lines[-1] else [])
    return '""\n' + "\n".join(parts)


def _unquote(chunks: list[str]) -> str:
    text = "".join(chunk[1:-1] for chunk in chunks)
    out, i = [], 0
    while i < len(text):
        char = text[i]
        if char == "\\" and i + 1 < len(text):
            nxt = text[i + 1]
            out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\"}.get(nxt, nxt))
            i += 2
        else:
            out.append(char)
            i += 1
    return "".join(out)


def read_po(path: Path) -> tuple[str, dict[Key, str]]:
    """Return (header msgstr, {(context, msgid): msgstr})."""
    if not path.exists():
        return "", {}
    entries: dict[Key, str] = {}
    header = ""
    field, buf = None, {"msgctxt": [], "msgid": [], "msgstr": []}

    def flush():
        nonlocal header
        if buf["msgid"] or buf["msgstr"]:
            msgid = _unquote(buf["msgid"])
            msgstr = _unquote(buf["msgstr"])
            ctx = _unquote(buf["msgctxt"]) if buf["msgctxt"] else None
            if msgid == "" and ctx is None:
                header = msgstr
            else:
                entries[(ctx, msgid)] = msgstr
        for k in buf:
            buf[k] = []

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            if not line:
                flush()
                field = None
            continue
        for keyword in ("msgctxt", "msgid", "msgstr"):
            if line.startswith(keyword + " "):
                if keyword in ("msgctxt",) or (keyword == "msgid" and buf["msgstr"]):
                    flush()
                field = keyword
                line = line[len(keyword) + 1 :]
                break
        if field and line.startswith('"'):
            buf[field].append(line)
    flush()
    return header, entries


def write_po(path: Path, lang: str, header: str, entries: dict[Key, str], origins: dict[Key, str]) -> None:
    header = header or (
        "Project-Id-Version: talkio\\n"
        "MIME-Version: 1.0\\n"
        "Content-Type: text/plain; charset=UTF-8\\n"
        "Content-Transfer-Encoding: 8bit\\n"
        f"Language: {lang}\\n"
        "Plural-Forms: nplurals=1; plural=0;\\n"
    ).replace("\\n", "\n")
    out = [
        "# Persian translations. Edit msgstr values, then run: python scripts/i18n.py compile",
        'msgid ""',
        _quote(header) if "\n" not in header else "msgstr " + _quote(header),
    ]
    if "\n" not in header:
        out[-1] = "msgstr " + out[-1]
    for key in sorted(entries, key=lambda k: (k[1].lower(), k[0] or "")):
        ctx, msgid = key
        out.append("")
        if key in origins:
            out.append(f"#: {origins[key]}")
        if ctx is not None:
            out.append(f"msgctxt {_quote(ctx)}")
        out.append(f"msgid {_quote(msgid)}")
        out.append(f"msgstr {_quote(entries[key])}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


def mo_bytes(header: str, entries: dict[Key, str]) -> bytes:
    """GNU .mo format: header, two offset tables, then the strings (no hash table)."""
    items = {"": header}
    for (ctx, msgid), msgstr in entries.items():
        if msgstr:
            items[f"{ctx}\x04{msgid}" if ctx else msgid] = msgstr
    keys = sorted(items)
    ids = b"".join(k.encode() + b"\0" for k in keys)
    strs = b"".join(items[k].encode() + b"\0" for k in keys)
    start = 7 * 4 + 16 * len(keys)
    id_table, str_table, offset = [], [], 0
    for k in keys:
        length = len(k.encode())
        id_table += [length, start + offset]
        offset += length + 1
    offset = 0
    for k in keys:
        length = len(items[k].encode())
        str_table += [length, start + len(ids) + offset]
        offset += length + 1
    head = struct.pack("Iiiiiii", 0x950412DE, 0, len(keys), 7 * 4, 7 * 4 + 8 * len(keys), 0, 0)
    return (
        head + struct.pack(f"{len(id_table)}i", *id_table) + struct.pack(f"{len(str_table)}i", *str_table) + ids + strs
    )


def catalogs():
    for source, locale_dir in DOMAINS.items():
        for lang in LANGUAGES:
            yield source, lang, locale_dir / lang / "LC_MESSAGES" / "django.po"


def main(command: str) -> int:
    failed = 0
    for source, lang, po in catalogs():
        found = scan(source)
        header, entries = read_po(po)
        rel = po.relative_to(ROOT)
        if command == "extract":
            merged = {key: entries.get(key, "") for key in found}
            dropped = len(set(entries) - set(found))
            write_po(po, lang, header, merged, found)
            print(
                f"{rel}: {len(merged)} messages, {sum(1 for v in merged.values() if not v)} untranslated, {dropped} obsolete removed"
            )
        elif command == "compile":
            po.with_suffix(".mo").write_bytes(mo_bytes(header or "Content-Type: text/plain; charset=UTF-8\n", entries))
            print(
                f"{po.with_suffix('.mo').relative_to(ROOT)}: compiled {sum(1 for v in entries.values() if v)} messages"
            )
        elif command == "check":
            missing = [key for key in found if not entries.get(key)]
            stale = (
                po.with_suffix(".mo").read_bytes()
                != mo_bytes(header or "Content-Type: text/plain; charset=UTF-8\n", entries)
                if po.with_suffix(".mo").exists()
                else True
            )
            for ctx, msgid in missing:
                print(f"{rel}: untranslated: {msgid!r}" + (f" (context {ctx!r})" if ctx else ""))
            if stale:
                print(f"{rel}: the .mo file is missing or stale; run: python scripts/i18n.py compile")
            failed += len(missing) + int(stale)
            if not missing and not stale:
                print(f"{rel}: {len(found)} messages, all translated")
        else:
            print(__doc__)
            return 2
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else ""))

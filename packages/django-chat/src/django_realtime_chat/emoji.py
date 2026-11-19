"""Emoji validation without third-party data.

Accepts one emoji "token": pictographs, flags (regional indicator pairs), keycaps,
skin-tone and gender sequences joined with ZWJ, variation selectors and tag sequences.
"""

from __future__ import annotations

_PICTOGRAPHIC = (
    (0x1F000, 0x1FAFF),
    (0x2600, 0x27BF),
    (0x2300, 0x23FF),
    (0x2B00, 0x2BFF),
    (0x2190, 0x21FF),
    (0x25A0, 0x25FF),
    (0x2900, 0x297F),
    (0x3030, 0x3030),
    (0x303D, 0x303D),
    (0x3297, 0x3297),
    (0x3299, 0x3299),
    (0x00A9, 0x00A9),
    (0x00AE, 0x00AE),
    (0x203C, 0x203C),
    (0x2049, 0x2049),
    (0x2122, 0x2122),
    (0x2139, 0x2139),
    (0x24C2, 0x24C2),
)
_JOINERS = {0x200D, 0xFE0F, 0xFE0E, 0x20E3}
_KEYCAP_BASES = set(map(ord, "0123456789#*"))


def _pictographic(code: int) -> bool:
    return any(lo <= code <= hi for lo, hi in _PICTOGRAPHIC)


def is_emoji(value: object, max_length: int = 16) -> bool:
    if not isinstance(value, str) or not value or len(value) > max_length:
        return False
    codes = [ord(ch) for ch in value]
    if codes[-1] == 0x20E3:  # keycap: digit/#/* [+ VS16] + U+20E3
        return codes[0] in _KEYCAP_BASES and all(c in _JOINERS for c in codes[1:])
    has_picture = False
    for code in codes:
        if _pictographic(code):
            has_picture = True
        elif code in _JOINERS or 0xE0020 <= code <= 0xE007F:  # tag sequences (subdivision flags)
            continue
        else:
            return False
    return has_picture

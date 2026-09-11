import sys
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit, urlunsplit, unquote

FEED = "_site/feed.xml"


def canonicalize(url: str) -> str:
    value = (url or "").strip()
    if not value:
        return ""
    try:
        p = urlsplit(value)
        # Fragment never changes image content. Normalize scheme/host case and decoded path.
        return urlunsplit((p.scheme.lower(), p.netloc.lower(), unquote(p.path), p.query, ""))
    except Exception:
        return value


root = ET.parse(FEED).getroot()
problems = []
checked = 0

for offer in root.findall(".//offer"):
    checked += 1
    offer_id = offer.get("id", "")
    name = (offer.findtext("name_ua") or offer.findtext("name") or "").strip()
    pictures = [
        (node.text or "").strip()
        for node in offer.findall("picture")
        if (node.text or "").strip()
    ]

    seen = {}
    duplicates = []
    for pos, url in enumerate(pictures, start=1):
        key = canonicalize(url)
        if key in seen:
            duplicates.append((seen[key], pos, url))
        else:
            seen[key] = pos

    if duplicates:
        problems.append((offer_id, name, duplicates))

if problems:
    print(f"Duplicate photo guard FAILED: {len(problems)} offers contain repeated photo URLs")
    for offer_id, name, duplicates in problems[:100]:
        print(f"- {offer_id} | {name}")
        for first_pos, dup_pos, url in duplicates:
            print(f"  photo {dup_pos} duplicates photo {first_pos}: {url}")
    if len(problems) > 100:
        print(f"... and {len(problems) - 100} more offers")
    sys.exit(1)

print(f"Duplicate photo guard OK: checked {checked} offers; repeated photo URLs: 0")

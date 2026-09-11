import json
import os
import sys
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit, unquote

CHOICES_FILE = "collar-photo-choices.json"
REPORT_FILE = "_site/collar-photo-report.json"
FEED_FILE = "_site/feed.xml"
STATS_FILE = "_site/stats.json"

for path in (CHOICES_FILE, REPORT_FILE, FEED_FILE, STATS_FILE):
    if not os.path.exists(path):
        raise SystemExit(f"Collar photo guard: required file missing: {path}")

with open(CHOICES_FILE, "r", encoding="utf-8") as f:
    choices = json.load(f)
with open(REPORT_FILE, "r", encoding="utf-8") as f:
    report = json.load(f)
with open(STATS_FILE, "r", encoding="utf-8") as f:
    stats = json.load(f)

root = ET.parse(FEED_FILE).getroot()
offers = {str(o.get("id") or "").strip(): o for o in root.findall(".//offer")}
report_by_id = {
    str(item.get("rozetka_offer_id") or item.get("source_id") or "").strip(): item
    for item in report
}


def photo_key(url):
    value = str(url or "").strip()
    if not value:
        return ""
    try:
        path = unquote(urlsplit(value).path)
    except Exception:
        path = value.split("?", 1)[0].split("#", 1)[0]
    return path.rstrip("/").rsplit("/", 1)[-1].lower()


def source_photo_by_position(item, position):
    for picture in item.get("pictures") or []:
        try:
            pos = int(picture.get("position"))
        except Exception:
            continue
        if pos == position:
            return str(picture.get("url") or "").strip()
    return ""

errors = []
validated_main = 0
skipped_no_report = 0
feed_choices = 0

for offer_id, choice in choices.items():
    offer_id = str(offer_id).strip()
    offer = offers.get(offer_id)
    if offer is None:
        continue

    feed_choices += 1
    item = report_by_id.get(offer_id)
    if item is None:
        # Some valid feed items can be absent from the current audit report.
        # Coverage is still protected below by the generator-applied counter.
        skipped_no_report += 1
        continue

    feed_pictures = [str(p.text or "").strip() for p in offer.findall("picture") if str(p.text or "").strip()]
    if not feed_pictures:
        errors.append(f"{offer_id}: no pictures in final feed")
        continue

    try:
        main_pos = int(choice.get("main_photo") or 0)
    except Exception:
        main_pos = 0

    if main_pos > 0:
        desired_main = source_photo_by_position(item, main_pos)
        if not desired_main:
            errors.append(f"{offer_id}: saved main_photo={main_pos}, but that source position no longer exists")
        elif photo_key(feed_pictures[0]) != photo_key(desired_main):
            errors.append(
                f"{offer_id}: WRONG MAIN PHOTO — expected source photo #{main_pos} "
                f"({photo_key(desired_main)}), got {photo_key(feed_pictures[0])}"
            )
        else:
            validated_main += 1

expected_applied = int(stats.get("collar_photo_choices_applied") or 0)
if expected_applied <= 0:
    errors.append("stats.json says collar_photo_choices_applied is zero/missing")
elif feed_choices != expected_applied:
    errors.append(
        f"saved-choice coverage mismatch: final feed contains {feed_choices} offers with saved choices, "
        f"but generator reports {expected_applied} choices applied"
    )

# Sentinel from the previously observed regression: this one must never silently revert.
sentinel = "3143850444"
if sentinel in offers and sentinel in choices:
    sentinel_choice = choices[sentinel]
    try:
        sentinel_main = int(sentinel_choice.get("main_photo") or 0)
    except Exception:
        sentinel_main = 0
    sentinel_item = report_by_id.get(sentinel)
    sentinel_feed = [str(p.text or "").strip() for p in offers[sentinel].findall("picture") if str(p.text or "").strip()]
    if not sentinel_item or not sentinel_feed or sentinel_main <= 0:
        errors.append(f"{sentinel}: sentinel validation could not be performed")
    else:
        expected = source_photo_by_position(sentinel_item, sentinel_main)
        if not expected or photo_key(sentinel_feed[0]) != photo_key(expected):
            errors.append(f"{sentinel}: sentinel AiryVest main photo regressed")

if errors:
    print("\nCOLLAR PHOTO GUARD FAILED. Feed will NOT be published.\n", file=sys.stderr)
    for error in errors[:50]:
        print(f"- {error}", file=sys.stderr)
    if len(errors) > 50:
        print(f"... and {len(errors) - 50} more errors", file=sys.stderr)
    raise SystemExit(1)

print(
    "Collar photo guard OK: "
    f"{feed_choices} saved choices covered; "
    f"{validated_main} main-photo checks passed; "
    f"{skipped_no_report} feed choices skipped because current audit report has no source gallery; "
    f"generator applied={expected_applied}."
)

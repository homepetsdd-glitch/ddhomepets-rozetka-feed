import math
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET

FEED_FILE = "_site/feed.xml"
SOURCE_URL = os.environ.get("PROM_SOURCE_URL", "").strip()

if not SOURCE_URL:
    raise SystemExit("Price guard: PROM_SOURCE_URL is missing")
if not os.path.exists(FEED_FILE):
    raise SystemExit(f"Price guard: missing {FEED_FILE}")

OLD_PRICE_TAGS = ["oldprice", "price_old", "priceold", "old_price"]
COLLAR_WORDS = [
    "collar", "waudog", "waucat", "evolutor", "dog extreme", "dog extremе",
    "airyvest", "puller", "liker", "flyber", "pitchdog", "superium", "supercat"
]


def text(node, tag):
    el = node.find(tag)
    return (el.text or "").strip() if el is not None and el.text is not None else ""


def parse_price(value):
    value = str(value or "").replace(" ", "").replace(",", ".")
    try:
        p = float(value)
    except Exception:
        return None
    return p if math.isfinite(p) and p > 0 else None


def regular_source_price(offer):
    # Generator intentionally removes Prom promo pricing and uses the regular/old price when supplied.
    for tag in OLD_PRICE_TAGS:
        p = parse_price(text(offer, tag))
        if p is not None:
            return p
    return parse_price(text(offer, "price"))


def is_collar_family(offer):
    vendor = text(offer, "vendor").lower()
    name = (text(offer, "name_ua") or text(offer, "name")).lower()
    if vendor in {"collar", "collar company"}:
        return True
    return any(word in vendor or word in name for word in COLLAR_WORDS)


def js_round_positive(x):
    return math.floor(x + 0.5)


def expected_rozetka_price(source_offer):
    base = regular_source_price(source_offer)
    if base is None:
        return None
    if is_collar_family(source_offer):
        return base
    if base <= 500:
        pct = 0.07
    elif base <= 1500:
        pct = 0.05
    else:
        pct = 0.03
    return float(js_round_positive(base * (1 + pct)))

# Read the exact current Prom source used as the business-price reference.
req = urllib.request.Request(
    SOURCE_URL,
    headers={
        "User-Agent": "D&D-Home-Pets-Rozetka-Price-Guard/1.0",
        "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
)
with urllib.request.urlopen(req, timeout=90) as response:
    source_xml = response.read()

source_root = ET.fromstring(source_xml)
source_offers = {
    str(o.get("id") or "").strip(): o
    for o in source_root.findall(".//offer")
    if str(o.get("id") or "").strip()
}

feed_root = ET.parse(FEED_FILE).getroot()
feed_offers = [o for o in feed_root.findall(".//offer")]

errors = []
checked = 0
collar_checked = 0
markup_checked = 0
skipped_remapped_or_missing = 0

for offer in feed_offers:
    oid = str(offer.get("id") or "").strip()
    actual = parse_price(text(offer, "price"))
    if actual is None:
        errors.append(f"{oid or '?'}: invalid or missing final price")
        continue

    source_offer = source_offers.get(oid)
    if source_offer is None:
        # Remapped legacy OFFERIDs do not necessarily have the same source ID.
        skipped_remapped_or_missing += 1
        continue

    expected = expected_rozetka_price(source_offer)
    if expected is None:
        errors.append(f"{oid}: source price is invalid")
        continue

    checked += 1
    if is_collar_family(source_offer):
        collar_checked += 1
    else:
        markup_checked += 1

    if abs(actual - expected) > 0.01:
        family = "COLLAR/no markup" if is_collar_family(source_offer) else "markup rule"
        errors.append(
            f"{oid}: WRONG PRICE — expected {expected:g} by {family}, got {actual:g}"
        )

# Coverage safety: this validator should check the overwhelming majority of the catalog.
if checked < 3300:
    errors.append(
        f"price validation coverage too low: checked only {checked} direct-ID offers; "
        f"skipped {skipped_remapped_or_missing}"
    )

if errors:
    print("\nPRICE GUARD FAILED. Feed will NOT be published.\n", file=sys.stderr)
    for error in errors[:80]:
        print(f"- {error}", file=sys.stderr)
    if len(errors) > 80:
        print(f"... and {len(errors) - 80} more errors", file=sys.stderr)
    raise SystemExit(1)

print(
    "Price guard OK: "
    f"{checked} direct-ID offers checked; "
    f"{collar_checked} COLLAR-family prices confirmed without markup; "
    f"{markup_checked} non-COLLAR prices confirmed by 7%/5%/3% rules; "
    f"{skipped_remapped_or_missing} remapped/missing-source IDs skipped."
)

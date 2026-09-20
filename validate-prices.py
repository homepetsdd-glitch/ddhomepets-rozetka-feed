import gzip
import json
import math
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET

FEED_FILE = "_site/feed.xml"
SOURCE_URL = os.environ.get("PROM_SOURCE_URL", "").strip()
OLD_PRICE_TAGS = ["oldprice", "price_old", "priceold", "old_price"]

if not SOURCE_URL:
    raise SystemExit("Price guard: PROM_SOURCE_URL is missing")
if not os.path.exists(FEED_FILE):
    raise SystemExit(f"Price guard: missing {FEED_FILE}")

COLLAR_WORDS = [
    "collar", "waudog", "waucat", "evolutor", "dog extreme", "dog extremе",
    "airyvest", "puller", "liker", "flyber", "pitchdog", "superium", "supercat",
    "gigwi", "pet's lab", "pets lab", "pet’s lab", "teremok"
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
    current = parse_price(text(offer, "price"))
    if current is None:
        return None, False
    base = current
    promo = False
    for tag in OLD_PRICE_TAGS:
        old = parse_price(text(offer, tag))
        if old is not None and old > base:
            base = old
            promo = True
    return base, promo


def load_collar_articles():
    out = set()
    for path in ["collar-current-vendorcodes.gz.b64", "collar-dropship-vendorcodes.gz.b64"]:
        if not os.path.exists(path):
            continue
        try:
            import base64
            packed = open(path, "r", encoding="utf-8").read().strip()
            raw = gzip.decompress(base64.b64decode(packed)).decode("utf-8").strip()
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    values = parsed
                elif isinstance(parsed, dict):
                    values = list(parsed.keys())
                else:
                    values = []
            except Exception:
                import re
                values = re.split(r"[\r\n,;\t]+", raw)
            for value in values:
                key = str(value or "").strip().lower()
                if key:
                    out.add(key)
        except Exception as exc:
            print(f"Price guard warning: could not read {path}: {exc}", file=sys.stderr)
    return out


COLLAR_ARTICLES = load_collar_articles()

def load_own_manual_collar_articles():
    path = "own-manual-collar-vendorcodes.txt"
    if not os.path.exists(path):
        return set()
    import re
    raw = open(path, "r", encoding="utf-8").read()
    return {x.strip().lower() for x in re.split(r"[\r\n,;\t]+", raw) if x.strip()}

OWN_MANUAL_COLLAR_ARTICLES = load_own_manual_collar_articles()

def is_own_manual_collar(offer):
    article = text(offer, "article").strip().lower()
    return bool(article and article in OWN_MANUAL_COLLAR_ARTICLES)


def is_collar_family(offer):
    vendor = text(offer, "vendor").lower()
    name = (text(offer, "name_ua") or text(offer, "name")).lower()
    article = text(offer, "article").strip().lower()
    if article and article in COLLAR_ARTICLES:
        return True
    if vendor in {"collar", "collar company"}:
        return True
    return any(word in vendor or word in name for word in COLLAR_WORDS)


def js_round_positive(x):
    return math.floor(x + 0.5)


def expected_rozetka_price(source_offer):
    base, promo = regular_source_price(source_offer)
    if base is None:
        return None, promo
    if is_collar_family(source_offer) and not is_own_manual_collar(source_offer):
        return float(base), promo
    if base <= 500:
        pct = 0.07
    elif base <= 1500:
        pct = 0.05
    else:
        pct = 0.03
    return float(js_round_positive(base * (1 + pct))), promo


def unique_index(offers, getter):
    out = {}
    duplicates = set()
    for offer in offers:
        key = str(getter(offer) or "").strip().lower()
        if not key:
            continue
        if key in out:
            duplicates.add(key)
        else:
            out[key] = offer
    for key in duplicates:
        out.pop(key, None)
    return out


req = urllib.request.Request(
    SOURCE_URL,
    headers={
        "User-Agent": "D&D-Home-Pets-Rozetka-Price-Guard/3.0",
        "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
)
with urllib.request.urlopen(req, timeout=90) as response:
    source_xml = response.read()

source_root = ET.fromstring(source_xml)
source_list = [o for o in source_root.findall(".//offer")]
source_by_id = {
    str(o.get("id") or "").strip(): o
    for o in source_list
    if str(o.get("id") or "").strip()
}
source_by_url = unique_index(source_list, lambda o: text(o, "url"))
source_by_article = unique_index(source_list, lambda o: text(o, "article"))

feed_root = ET.parse(FEED_FILE).getroot()
feed_offers = [o for o in feed_root.findall(".//offer")]

errors = []
checked = 0
collar_checked = 0
markup_checked = 0
promo_checked = 0
matched_by_id = 0
matched_by_url = 0
matched_by_article = 0
skipped_missing = 0

for offer in feed_offers:
    oid = str(offer.get("id") or "").strip()
    actual = parse_price(text(offer, "price"))
    if actual is None:
        errors.append(f"{oid or '?'}: invalid or missing final price")
        continue

    # Final feed must not expose sale/old-price tags at all.
    for tag in OLD_PRICE_TAGS + ["price_promo"]:
        if text(offer, tag):
            errors.append(f"{oid}: discount tag <{tag}> leaked into final feed")

    source_offer = source_by_id.get(oid)
    if source_offer is not None:
        matched_by_id += 1
    else:
        url = text(offer, "url").strip().lower()
        source_offer = source_by_url.get(url) if url else None
        if source_offer is not None:
            matched_by_url += 1
        else:
            article = text(offer, "article").strip().lower()
            source_offer = source_by_article.get(article) if article else None
            if source_offer is not None:
                matched_by_article += 1

    if source_offer is None:
        skipped_missing += 1
        continue

    expected, promo = expected_rozetka_price(source_offer)
    if expected is None:
        errors.append(f"{oid}: source regular price is invalid")
        continue

    checked += 1
    if promo:
        promo_checked += 1
    if is_collar_family(source_offer) and not is_own_manual_collar(source_offer):
        collar_checked += 1
    else:
        markup_checked += 1

    if abs(actual - expected) > 0.01:
        family = "COLLAR/no markup" if (is_collar_family(source_offer) and not is_own_manual_collar(source_offer)) else "markup rule"
        base, _ = regular_source_price(source_offer)
        errors.append(
            f"{oid}: WRONG PRICE — expected {expected:g} from regular Prom price {base:g} by {family}, got {actual:g}"
        )

if checked < 3300:
    errors.append(
        f"price validation coverage too low: checked only {checked} matched offers; skipped {skipped_missing}"
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
    f"{checked} offers checked; "
    f"{promo_checked} source promo offers verified from regular pre-discount price; "
    f"{collar_checked} COLLAR-family prices confirmed without markup; "
    f"{markup_checked} non-COLLAR prices confirmed by 7%/5%/3% rules; "
    f"matches id/url/article={matched_by_id}/{matched_by_url}/{matched_by_article}; "
    f"{skipped_missing} source-missing offers skipped."
)

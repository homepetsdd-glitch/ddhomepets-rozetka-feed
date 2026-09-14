import xml.etree.ElementTree as ET

PATH = "_site/feed.xml"
WORDS = ("collar", "waudog", "waucat", "evolutor", "dog extreme", "airyvest", "puller", "liker", "flyber", "pitchdog", "superium", "supercat")
QTY_TAGS = ("quantity_in_stock", "quantity", "stock_quantity", "stock")

def text(offer, tag):
    node = offer.find(tag)
    return "" if node is None or node.text is None else node.text.strip()

def is_collar(offer):
    vendor = text(offer, "vendor").lower()
    name = (text(offer, "name_ua") or text(offer, "name")).lower()
    return vendor in ("collar", "collar company") or any(word in name for word in WORDS)

def quantity(offer):
    for tag in QTY_TAGS:
        raw = text(offer, tag)
        if not raw:
            continue
        try:
            return float(raw.replace(" ", "").replace(",", "."))
        except ValueError:
            pass
    return None

tree = ET.parse(PATH)
root = tree.getroot()
matched = unavailable = available = skipped = 0
for offer in root.findall(".//offer"):
    if not is_collar(offer):
        continue
    matched += 1
    qty = quantity(offer)
    if qty is None:
        skipped += 1
        continue
    flag = qty > 0
    offer.set("available", "true" if flag else "false")
    if flag:
        available += 1
    else:
        unavailable += 1

tree.write(PATH, encoding="utf-8", xml_declaration=True)
print(f"Collar availability: matched={matched}, available={available}, unavailable={unavailable}, skipped_no_qty={skipped}")

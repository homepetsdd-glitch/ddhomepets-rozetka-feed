import fs from "node:fs";

const IDS_FILE = "excluded-offerids.txt";
const FEED_FILE = "_site/feed.xml";

const excluded = new Set(
  fs.readFileSync(IDS_FILE, "utf8")
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
);

let xml = fs.readFileSync(FEED_FILE, "utf8");
let removed = 0;

for (const id of excluded) {
  const patterns = [
    new RegExp(`<offer\\b[^>]*\\bid=["']${id}["'][\\s\\S]*?<\\/offer>\\s*`, "g"),
    new RegExp(`<offer\\b[^>]*\\bofferid=["']${id}["'][\\s\\S]*?<\\/offer>\\s*`, "g")
  ];
  for (const pattern of patterns) {
    xml = xml.replace(pattern, (m) => {
      removed += 1;
      return "";
    });
  }
}

const collarWords = [
  "collar", "waudog", "waucat", "evolutor", "dog extreme",
  "airyvest", "puller", "liker", "flyber", "pitchdog",
  "superium", "supercat"
];

function getTag(offer, tag) {
  const m = offer.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return String(m[1] || "")
    .replace(/^<!\[CDATA\[/i, "")
    .replace(/\]\]>$/i, "")
    .trim();
}

function isCollar(offer) {
  const vendor = getTag(offer, "vendor").toLowerCase();
  const name = (getTag(offer, "name_ua") || getTag(offer, "name")).toLowerCase();
  return vendor === "collar" || vendor === "collar company" || collarWords.some(w => name.includes(w));
}

function getQty(offer) {
  for (const tag of ["quantity_in_stock", "quantity", "stock_quantity", "stock"]) {
    const raw = getTag(offer, tag);
    if (!raw) continue;
    const n = Number(raw.replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function setAvailable(offer, value) {
  return offer.replace(/<offer\b([^>]*)>/i, (full, attrs) => {
    const flag = value ? "true" : "false";
    if (/\bavailable\s*=\s*["'][^"']*["']/i.test(attrs)) {
      return `<offer${attrs.replace(/\bavailable\s*=\s*(["'])[^"']*\1/i, `available="${flag}"`)}>`;
    }
    return `<offer${attrs} available="${flag}">`;
  });
}

let collarMatched = 0;
let collarUnavailable = 0;
let collarAvailable = 0;
let collarSkippedNoQty = 0;

xml = xml.replace(/<offer\b[\s\S]*?<\/offer>/gi, offer => {
  if (!isCollar(offer)) return offer;
  collarMatched += 1;
  const qty = getQty(offer);
  if (qty === null) {
    collarSkippedNoQty += 1;
    return offer;
  }
  if (qty <= 0) {
    collarUnavailable += 1;
    return setAvailable(offer, false);
  }
  collarAvailable += 1;
  return setAvailable(offer, true);
});

fs.writeFileSync(FEED_FILE, xml, "utf8");

for (const id of excluded) {
  if (xml.includes(`id=\"${id}\"`) || xml.includes(`id='${id}'`) || xml.includes(`offerid=\"${id}\"`) || xml.includes(`offerid='${id}'`)) {
    throw new Error(`Safety stop: excluded OFFERID ${id} is still present in feed`);
  }
}

console.log(`Excluded OFFERIDs: ${[...excluded].join(", ")}`);
console.log(`Removed offer blocks: ${removed}`);
console.log(`Collar availability: matched=${collarMatched}, available=${collarAvailable}, unavailable=${collarUnavailable}, skipped_no_qty=${collarSkippedNoQty}`);

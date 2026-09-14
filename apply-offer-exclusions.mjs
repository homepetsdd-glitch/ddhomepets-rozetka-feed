import fs from "node:fs";
import zlib from "node:zlib";

const IDS_FILE = "excluded-offerids.txt";
const FEED_FILE = "_site/feed.xml";
const DROP_CODES_FILE = "collar-dropship-vendorcodes.gz.b64";
const STOCK_SNAPSHOT_FILE = "collar-current-stock.json.gz.b64";

const OWN_COLLAR_OFFERIDS = new Set([
  "3130719899", "3130776756", "3139690259",
  "3193655400", "3193646775", "3193648349",
  "3193677892", "3193668251", "3193686091"
]);

function readGzipText(path) {
  const b64 = fs.readFileSync(path, "utf8").trim();
  return zlib.gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
}

function loadDropshipCodes() {
  return new Set(
    readGzipText(DROP_CODES_FILE)
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
  );
}

function loadSnapshotStock() {
  return new Map(Object.entries(JSON.parse(readGzipText(STOCK_SNAPSHOT_FILE))));
}

function getTag(offer, tag) {
  const m = offer.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return String(m[1] || "")
    .replace(/^<!\[CDATA\[/i, "")
    .replace(/\]\]>$/i, "")
    .trim();
}

function getOfferId(offer) {
  const m = offer.match(/<offer\b[^>]*\b(?:id|offerid)=(["'])([^"']+)\1/i);
  return m ? m[2].trim() : "";
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

function setStockQuantity(offer, qty) {
  const value = String(Math.max(0, Number(qty) || 0));
  if (/<stock_quantity\b[^>]*>[\s\S]*?<\/stock_quantity>/i.test(offer)) {
    return offer.replace(/<stock_quantity\b[^>]*>[\s\S]*?<\/stock_quantity>/i, `<stock_quantity>${value}</stock_quantity>`);
  }
  return offer.replace(/<\/offer>/i, `<stock_quantity>${value}</stock_quantity></offer>`);
}

function parseSupplierStock(sourceXml) {
  const stock = new Map();
  const offers = sourceXml.match(/<offer\b[\s\S]*?<\/offer>/gi) || [];
  for (const offer of offers) {
    const article = getTag(offer, "vendorCode");
    if (!article) continue;
    const rawQty = getTag(offer, "quantity_in_stock");
    const qty = Number(String(rawQty).replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(qty) && qty > 0) stock.set(article, qty);
  }
  if (stock.size < 3000) {
    throw new Error(`Safety stop: Collar source returned only ${stock.size} stocked articles`);
  }
  return stock;
}

async function getCollarStock() {
  const liveUrl = String(process.env.COLLAR_SOURCE_URL || "").trim();
  if (!liveUrl) {
    const snapshot = loadSnapshotStock();
    console.log(`Collar stock source: snapshot (${snapshot.size} articles)`);
    return snapshot;
  }

  const response = await fetch(liveUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`Collar source HTTP ${response.status}`);
  const sourceXml = await response.text();
  const stock = parseSupplierStock(sourceXml);
  console.log(`Collar stock source: live XML (${stock.size} articles)`);
  return stock;
}

const excluded = new Set(
  fs.readFileSync(IDS_FILE, "utf8")
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
);

const dropshipCodes = loadDropshipCodes();
const collarStock = await getCollarStock();

let xml = fs.readFileSync(FEED_FILE, "utf8");
let removed = 0;

for (const id of excluded) {
  const patterns = [
    new RegExp(`<offer\\b[^>]*\\bid=["']${id}["'][\\s\\S]*?<\\/offer>\\s*`, "g"),
    new RegExp(`<offer\\b[^>]*\\bofferid=["']${id}["'][\\s\\S]*?<\\/offer>\\s*`, "g")
  ];
  for (const pattern of patterns) {
    xml = xml.replace(pattern, () => {
      removed += 1;
      return "";
    });
  }
}

let matched = 0;
let available = 0;
let unavailable = 0;
let ownSkipped = 0;
let noArticleSkipped = 0;
let quantityChanged = 0;

xml = xml.replace(/<offer\b[\s\S]*?<\/offer>/gi, offer => {
  const id = getOfferId(offer);
  if (OWN_COLLAR_OFFERIDS.has(id)) {
    ownSkipped += 1;
    return offer;
  }

  const article = getTag(offer, "article");
  if (!article) {
    noArticleSkipped += 1;
    return offer;
  }
  if (!dropshipCodes.has(article)) return offer;

  matched += 1;
  const qty = Number(collarStock.get(article) || 0);
  let out = setAvailable(offer, qty > 0);

  const oldQty = Number(String(getTag(offer, "stock_quantity") || "0").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(oldQty) || oldQty !== qty) quantityChanged += 1;
  out = setStockQuantity(out, qty);

  if (qty > 0) available += 1;
  else unavailable += 1;
  return out;
});

fs.writeFileSync(FEED_FILE, xml, "utf8");

for (const id of excluded) {
  if (xml.includes(`id=\"${id}\"`) || xml.includes(`id='${id}'`) || xml.includes(`offerid=\"${id}\"`) || xml.includes(`offerid='${id}'`)) {
    throw new Error(`Safety stop: excluded OFFERID ${id} is still present in feed`);
  }
}

console.log(`Excluded OFFERIDs: ${[...excluded].join(", ")}`);
console.log(`Removed offer blocks: ${removed}`);
console.log(`Collar dropship sync: allowlist=${dropshipCodes.size}, matched=${matched}, available=${available}, unavailable=${unavailable}, quantity_changed=${quantityChanged}, own_skipped=${ownSkipped}, no_article_skipped=${noArticleSkipped}`);

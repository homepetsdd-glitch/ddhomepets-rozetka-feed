import fs from "node:fs";
import zlib from "node:zlib";

const DROP_CODES_FILE = "collar-dropship-vendorcodes.gz.b64";
const OWN_MANUAL_CODES_FILE = "own-manual-collar-vendorcodes.txt";
const IMPORT_ID_MAP_FILE = "prom-collar-import-id-map.tsv";
const OUT_FILE = "_site/prom-collar-feed.xml";

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
  return new Set(readGzipText(DROP_CODES_FILE).split(/\r?\n/).map(s => s.trim()).filter(Boolean));
}

function loadOwnManualCodes() {
  return new Set(
    fs.readFileSync(OWN_MANUAL_CODES_FILE, "utf8")
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
  );
}

function loadImportIdMap() {
  const out = new Map();
  for (const line of fs.readFileSync(IMPORT_ID_MAP_FILE, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = String(parts[0] || "").trim();
    const importId = String(parts[1] || "").trim();
    if (code && importId) out.set(code, importId);
  }
  if (out.size < 3300) throw new Error("Safety stop: stable Prom import-ID map has only " + out.size + " entries");
  return out;
}

function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return String(m[1] || "").replace(/^<!\[CDATA\[/i, "").replace(/\]\]>$/i, "").trim();
}

function getOfferId(offer) {
  const m = offer.match(/<offer\b[^>]*\b(?:id|offerid)=(["'])([^"']+)\1/i);
  return m ? m[2].trim() : "";
}

function getArticle(offer) {
  return getTag(offer, "vendorCode") || getTag(offer, "article") || getTag(offer, "code");
}

function setOfferId(offer, importId) {
  return offer.replace(
    /<offer\b([^>]*?)\bid=(["'])\s*[^"']+\2/i,
    (full, before, q) => "<offer" + before + "id=" + q + String(importId) + q
  );
}


function setAvailable(offer, value) {
  const flag = value ? "true" : "false";
  return offer.replace(/<offer\b([^>]*)>/i, (full, attrs) => {
    if (/\bavailable\s*=\s*["'][^"']*["']/i.test(attrs)) {
      return `<offer${attrs.replace(/\bavailable\s*=\s*(["'])[^"']*\1/i, `available="${flag}"`)}>`;
    }
    return `<offer${attrs} available="${flag}">`;
  });
}

function setStockQuantity(offer, qty) {
  const value = String(Math.max(0, Math.floor(Number(qty) || 0)));
  if (/<quantity_in_stock\b[^>]*>[\s\S]*?<\/quantity_in_stock>/i.test(offer)) return offer.replace(/<quantity_in_stock\b[^>]*>[\s\S]*?<\/quantity_in_stock>/i, `<quantity_in_stock>${value}</quantity_in_stock>`);
  if (/<stock_quantity\b[^>]*>[\s\S]*?<\/stock_quantity>/i.test(offer)) return offer.replace(/<stock_quantity\b[^>]*>[\s\S]*?<\/stock_quantity>/i, `<stock_quantity>${value}</stock_quantity>`);
  if (/<quantity\b[^>]*>[\s\S]*?<\/quantity>/i.test(offer)) return offer.replace(/<quantity\b[^>]*>[\s\S]*?<\/quantity>/i, `<quantity>${value}</quantity>`);
  return offer.replace(/<\/offer>/i, `<quantity_in_stock>${value}</quantity_in_stock></offer>`);
}

function setPrice(offer, price) {
  const value = String(Number(price));
  if (/<price\b[^>]*>[\s\S]*?<\/price>/i.test(offer)) {
    return offer.replace(/<price\b[^>]*>[\s\S]*?<\/price>/i, `<price>${value}</price>`);
  }
  return offer.replace(/<\/offer>/i, `<price>${value}</price></offer>`);
}

function removeDiscountTags(offer) {
  let out = offer;
  for (const tag of ["oldprice", "price_old", "priceold", "old_price", "price_promo"]) {
    out = out.replace(new RegExp(`\\s*<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), "");
  }
  return out;
}

function applyOwnFixedOverride(offer, override) {
  let out = removeDiscountTags(offer);
  out = setPrice(out, override.price);
  out = setStockQuantity(out, override.stock);
  out = setAvailable(out, override.stock > 0);
  return out;
}

function parseNumber(value) {
  const n = Number(String(value || "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseCollarCatalog(xml) {
  const catalog = new Map();
  for (const offer of xml.match(/<offer\b[\s\S]*?<\/offer>/gi) || []) {
    const code = getTag(offer, "vendorCode");
    if (!code) continue;

    const rawQty = getTag(offer, "quantity_in_stock") || getTag(offer, "quantity");
    const parsedQty = parseNumber(rawQty);
    const qty = parsedQty !== null && parsedQty > 0 ? parsedQty : 0;

    // Collar YML uses <price> as the current selling price.
    const parsedPrice = parseNumber(getTag(offer, "price"));
    const price = parsedPrice !== null && parsedPrice > 0 ? parsedPrice : null;

    catalog.set(code, { qty, price });
  }
  if (catalog.size < 3000) throw new Error(`Safety stop: Collar source returned only ${catalog.size} articles`);
  return catalog;
}

async function fetchText(url, label) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  return await response.text();
}

const collarUrl = String(process.env.COLLAR_SOURCE_URL || "").trim();
if (!collarUrl) throw new Error("COLLAR_SOURCE_URL is missing");

const collarXml = await fetchText(collarUrl, "Collar source");
const dropshipCodes = loadDropshipCodes();
const ownManualCodes = loadOwnManualCodes();
const importIds = loadImportIdMap();
const collarCatalog = parseCollarCatalog(collarXml);

const openMatch = collarXml.match(/<offers\b[^>]*>/i);
const closeIndex = collarXml.search(/<\/offers>/i);
if (!openMatch || closeIndex < 0 || openMatch.index == null) throw new Error("Collar source has no <offers> block");

const openEnd = openMatch.index + openMatch[0].length;
const head = collarXml.slice(0, openEnd);
const tail = collarXml.slice(closeIndex);
const offersBlock = collarXml.slice(openEnd, closeIndex);
const offers = offersBlock.match(/<offer\b[\s\S]*?<\/offer>/gi) || [];
if (offers.length < 4000) throw new Error("Safety stop: Collar source has only " + offers.length + " offers");

let matched = 0;
let available = 0;
let unavailable = 0;
let ownManualExcluded = 0;
let notDropshipSkipped = 0;
let unmappedSkipped = 0;
let invalidPriceSkipped = 0;
const outOffers = [];

for (const original of offers) {
  const code = getTag(original, "vendorCode");
  if (!code) continue;

  // One shared protection list for both Rozetka and Prom.
  if (ownManualCodes.has(code)) {
    ownManualExcluded += 1;
    continue;
  }

  // Only confirmed Collar dropship positions belong in this Prom updater.
  if (!dropshipCodes.has(code)) {
    notDropshipSkipped += 1;
    continue;
  }

  // Critical: Prom updates by the stable import ID used by the old Worker,
  // not by the current public product-page ID.
  const importId = importIds.get(code);
  if (!importId) {
    // SAFE MODE: never create a new product automatically.
    unmappedSkipped += 1;
    continue;
  }

  const supplier = collarCatalog.get(code);
  if (!supplier || supplier.price === null) {
    invalidPriceSkipped += 1;
    continue;
  }

  const supplierQty = Math.max(0, Math.floor(Number(supplier.qty) || 0));
  const qty = supplierQty <= 4 ? 0 : supplierQty;

  let out = setOfferId(original, importId);
  out = setStockQuantity(setAvailable(out, qty > 0), qty);
  out = setPrice(out, supplier.price);
  outOffers.push(out);

  matched += 1;
  if (qty > 0) available += 1;
  else unavailable += 1;
}

if (matched < 2300) throw new Error("Safety stop: only " + matched + " existing Prom Collar products matched stable import IDs");
if (invalidPriceSkipped > 20) throw new Error("Safety stop: " + invalidPriceSkipped + " mapped Collar products have invalid prices");

fs.mkdirSync("_site", { recursive: true });
fs.writeFileSync(OUT_FILE, head + "\n" + outOffers.join("\n") + "\n" + tail, "utf8");

console.log(
  "Prom safe existing-only feed: upstream=" + offers.length +
  ", output=" + outOffers.length +
  ", stable_id_map=" + importIds.size +
  ", dropship_allowlist=" + dropshipCodes.size +
  ", available=" + available +
  ", unavailable=" + unavailable +
  ", own_manual_excluded=" + ownManualExcluded +
  ", unmapped_skipped=" + unmappedSkipped +
  ", non_dropship_skipped=" + notDropshipSkipped +
  ", invalid_price_skipped=" + invalidPriceSkipped
);
console.log("Wrote " + OUT_FILE);

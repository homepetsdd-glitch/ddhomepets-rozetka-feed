import fs from "node:fs";
import zlib from "node:zlib";

const DROP_CODES_FILE = "collar-dropship-vendorcodes.gz.b64";
const OWN_MANUAL_CODES_FILE = "own-manual-collar-vendorcodes.txt";
const IMPORT_ID_MAP_FILE = "prom-collar-import-id-map.tsv";
const BASELINE_IGNORED_CODES_FILE = "prom-collar-baseline-ignored-vendorcodes.txt";
const OUT_FILE = "_site/prom-collar-feed.xml";

const BASELINE_DATE = "2026-08-26";
const TECH_CATEGORY_ID = "999901";
const TECH_CATEGORY_NAME = "Новинки Collar — розподілити";
const MAX_FUTURE_NEW_CODES = 1000;

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

function loadBaselineIgnoredCodes() {
  return new Set(
    fs.readFileSync(BASELINE_IGNORED_CODES_FILE, "utf8")
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


function setCategoryId(offer, categoryId) {
  if (/<categoryId\b[^>]*>[\s\S]*?<\/categoryId>/i.test(offer)) {
    return offer.replace(
      /<categoryId\b[^>]*>[\s\S]*?<\/categoryId>/i,
      "<categoryId>" + categoryId + "</categoryId>"
    );
  }
  if (/<currencyId\b[^>]*>[\s\S]*?<\/currencyId>/i.test(offer)) {
    return offer.replace(
      /(<currencyId\b[^>]*>[\s\S]*?<\/currencyId>)/i,
      "$1\n<categoryId>" + categoryId + "</categoryId>"
    );
  }
  return offer.replace(
    /(<price\b[^>]*>[\s\S]*?<\/price>)/i,
    "$1\n<categoryId>" + categoryId + "</categoryId>"
  );
}

function replaceCategoriesWithSingle(headXml) {
  const safeName = TECH_CATEGORY_NAME
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const block =
    "<categories>\n" +
    "<category id=\"" + TECH_CATEGORY_ID + "\">" + safeName + "</category>\n" +
    "</categories>";
  if (/<categories\b[^>]*>[\s\S]*?<\/categories>/i.test(headXml)) {
    return headXml.replace(/<categories\b[^>]*>[\s\S]*?<\/categories>/i, block);
  }
  return headXml;
}

function makePromSafeOfferName(offerXml) {
  const m = offerXml.match(/<name\b[^>]*>([\s\S]*?)<\/name>/i);
  if (!m) return offerXml;

  let name = String(m[1] || "")
    .replace(/^<!\[CDATA\[/i, "")
    .replace(/\]\]>$/i, "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

  if (name.length <= 130) return offerXml;

  let shortened = name.slice(0, 131).replace(/\s+\S*$/, "").replace(/[,\s]+$/, "");
  if (!shortened) shortened = name.slice(0, 130);
  const safe = shortened.replace(/\]\]>/g, "]]]]><![CDATA[>");
  return offerXml.replace(/<name\b[^>]*>[\s\S]*?<\/name>/i, "<name><![CDATA[" + safe + "]]></name>");
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
const baselineIgnoredCodes = loadBaselineIgnoredCodes();
const collarCatalog = parseCollarCatalog(collarXml);

if (baselineIgnoredCodes.size !== 1618) {
  throw new Error("Safety stop: expected 1618 baseline-ignored Collar codes, got " + baselineIgnoredCodes.size);
}

const openMatch = collarXml.match(/<offers\b[^>]*>/i);
const closeIndex = collarXml.search(/<\/offers>/i);
if (!openMatch || closeIndex < 0 || openMatch.index == null) throw new Error("Collar source has no <offers> block");

const openEnd = openMatch.index + openMatch[0].length;
let head = collarXml.slice(0, openEnd);
const tail = collarXml.slice(closeIndex);
const offersBlock = collarXml.slice(openEnd, closeIndex);
const offers = offersBlock.match(/<offer\b[\s\S]*?<\/offer>/gi) || [];
if (offers.length < 4000) throw new Error("Safety stop: Collar source has only " + offers.length + " offers");

head = replaceCategoriesWithSingle(head);

let existingMatched = 0;
let existingAvailable = 0;
let existingUnavailable = 0;
let ownManualExcluded = 0;
let baselineIgnoredPresent = 0;
let futureNewTotal = 0;
let futureNewAvailable = 0;
let futureNewUnavailable = 0;
let invalidExistingPrice = 0;
let invalidNewPrice = 0;
let missingNewId = 0;
let newIdCollisions = 0;
let duplicateOutputIds = 0;

const outOffers = [];
const seenExistingCodes = new Set();
const usedOutputIds = new Map();
const mappedImportIds = new Set(importIds.values());

function pushUniqueOffer(out, code) {
  const id = getOfferId(out);
  if (!id) {
    duplicateOutputIds += 1;
    return;
  }
  const previous = usedOutputIds.get(id);
  if (previous && previous !== code) {
    duplicateOutputIds += 1;
    return;
  }
  usedOutputIds.set(id, code);
  outOffers.push(out);
}

for (const originalRaw of offers) {
  const code = getTag(originalRaw, "vendorCode");
  if (!code) continue;

  // One shared protection list for Rozetka + Prom.
  // Purchased/manual items do not participate in supplier price/stock sync.
  if (ownManualCodes.has(code)) {
    ownManualExcluded += 1;
    continue;
  }

  const supplier = collarCatalog.get(code);
  const price = supplier ? supplier.price : null;
  const supplierQty = supplier ? Math.max(0, Math.floor(Number(supplier.qty) || 0)) : 0;
  const qty = supplierQty <= 4 ? 0 : supplierQty;

  const importId = importIds.get(code);
  if (importId) {
    seenExistingCodes.add(code);

    if (price === null) {
      invalidExistingPrice += 1;
      continue;
    }

    let out = setOfferId(originalRaw, importId);
    out = setCategoryId(out, TECH_CATEGORY_ID);
    out = setStockQuantity(setAvailable(out, qty > 0), qty);
    out = setPrice(out, price);
    pushUniqueOffer(out, code);

    existingMatched += 1;
    if (qty > 0) existingAvailable += 1;
    else existingUnavailable += 1;
    continue;
  }

  // Everything that already existed at the 26.08.2026 baseline but was not
  // in our Prom catalog remains permanently ignored. This prevents mass imports
  // of the supplier's old catalog.
  if (baselineIgnoredCodes.has(code)) {
    baselineIgnoredPresent += 1;
    continue;
  }

  // A vendorCode absent from both the stable Prom map and the 26.08 baseline
  // is treated as a genuine future Collar new product.
  futureNewTotal += 1;

  if (qty <= 0) {
    futureNewUnavailable += 1;
    continue;
  }
  if (price === null) {
    invalidNewPrice += 1;
    continue;
  }

  const originalId = getOfferId(originalRaw);
  if (!originalId) {
    missingNewId += 1;
    continue;
  }

  // New products keep the original stable Collar offer ID, exactly as the old
  // Worker did. Refuse any collision with an existing Prom import ID.
  if (mappedImportIds.has(originalId)) {
    newIdCollisions += 1;
    continue;
  }

  let out = makePromSafeOfferName(originalRaw);
  out = setCategoryId(out, TECH_CATEGORY_ID);
  out = setStockQuantity(setAvailable(out, true), qty);
  out = setPrice(out, price);
  pushUniqueOffer(out, code);
  futureNewAvailable += 1;
}

if (existingMatched < 2300) {
  throw new Error("Safety stop: only " + existingMatched + " existing Prom Collar products matched stable import IDs");
}
if (futureNewTotal > MAX_FUTURE_NEW_CODES) {
  throw new Error("Safety stop: " + futureNewTotal + " future-new Collar codes exceeds limit " + MAX_FUTURE_NEW_CODES);
}
if (invalidExistingPrice > 20) {
  throw new Error("Safety stop: " + invalidExistingPrice + " existing mapped Collar products have invalid prices");
}
if (newIdCollisions > 0) {
  throw new Error("Safety stop: " + newIdCollisions + " future-new Collar IDs collide with existing Prom import IDs");
}
if (duplicateOutputIds > 0) {
  throw new Error("Safety stop: " + duplicateOutputIds + " duplicate output IDs detected");
}
if (missingNewId > 0) {
  throw new Error("Safety stop: " + missingNewId + " future-new Collar offers have no offer ID");
}

fs.mkdirSync("_site", { recursive: true });
fs.writeFileSync(OUT_FILE, head + "\n" + outOffers.join("\n") + "\n" + tail, "utf8");

console.log(
  "Prom safe existing+new feed: baseline_date=" + BASELINE_DATE +
  ", upstream=" + offers.length +
  ", output=" + outOffers.length +
  ", stable_id_map=" + importIds.size +
  ", dropship_snapshot=" + dropshipCodes.size +
  ", own_manual_list=" + ownManualCodes.size +
  ", own_manual_excluded=" + ownManualExcluded +
  ", existing_matched=" + existingMatched +
  ", existing_available=" + existingAvailable +
  ", existing_unavailable=" + existingUnavailable +
  ", existing_missing_from_collar=" + (importIds.size - seenExistingCodes.size) +
  ", baseline_ignored_total=" + baselineIgnoredCodes.size +
  ", baseline_ignored_present=" + baselineIgnoredPresent +
  ", future_new_total=" + futureNewTotal +
  ", future_new_available_emitted=" + futureNewAvailable +
  ", future_new_unavailable_skipped=" + futureNewUnavailable +
  ", invalid_existing_price=" + invalidExistingPrice +
  ", invalid_new_price=" + invalidNewPrice
);
console.log("Wrote " + OUT_FILE);

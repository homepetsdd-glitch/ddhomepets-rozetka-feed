import fs from "node:fs";
import zlib from "node:zlib";

const DROP_CODES_FILE = "collar-dropship-vendorcodes.gz.b64";
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

function parseCollarStock(xml) {
  const stock = new Map();
  for (const offer of xml.match(/<offer\b[\s\S]*?<\/offer>/gi) || []) {
    const code = getTag(offer, "vendorCode");
    if (!code) continue;
    const raw = getTag(offer, "quantity_in_stock") || getTag(offer, "quantity");
    const qty = Number(String(raw).replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(qty) && qty > 0) stock.set(code, qty);
  }
  if (stock.size < 3000) throw new Error(`Safety stop: Collar source returned only ${stock.size} stocked articles`);
  return stock;
}

async function fetchText(url, label) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  return await response.text();
}

const promUrl = String(process.env.PROM_SOURCE_URL || "").trim();
const collarUrl = String(process.env.COLLAR_SOURCE_URL || "").trim();
if (!promUrl) throw new Error("PROM_SOURCE_URL is missing");
if (!collarUrl) throw new Error("COLLAR_SOURCE_URL is missing");

const [promXml, collarXml] = await Promise.all([fetchText(promUrl, "Prom source"), fetchText(collarUrl, "Collar source")]);
const dropshipCodes = loadDropshipCodes();
const collarStock = parseCollarStock(collarXml);

const openMatch = promXml.match(/<offers\b[^>]*>/i);
const closeIndex = promXml.search(/<\/offers>/i);
if (!openMatch || closeIndex < 0 || openMatch.index == null) throw new Error("Prom source has no <offers> block");

const openEnd = openMatch.index + openMatch[0].length;
const head = promXml.slice(0, openEnd);
const tail = promXml.slice(closeIndex);
const offersBlock = promXml.slice(openEnd, closeIndex);
const offers = offersBlock.match(/<offer\b[\s\S]*?<\/offer>/gi) || [];

let matched = 0, available = 0, unavailable = 0, ownSkipped = 0, noArticle = 0;
const outOffers = [];

for (const original of offers) {
  const id = getOfferId(original);
  const code = getArticle(original);
  let out = original;

  if (OWN_COLLAR_OFFERIDS.has(id)) {
    ownSkipped += 1;
  } else if (!code) {
    noArticle += 1;
  } else if (dropshipCodes.has(code)) {
    matched += 1;
    const qty = Number(collarStock.get(code) || 0);
    out = setStockQuantity(setAvailable(original, qty > 0), qty);
    if (qty > 0) available += 1; else unavailable += 1;
  }

  // Keep every source offer. Only confirmed Collar dropship stock fields are changed.
  outOffers.push(out);
}

if (matched < 3000) throw new Error(`Safety stop: only ${matched} Prom Collar dropship offers matched`);
if (outOffers.length !== offers.length) throw new Error("Safety stop: source offer count changed");

fs.mkdirSync("_site", { recursive: true });
fs.writeFileSync(OUT_FILE, `${head}\n${outOffers.join("\n")}\n${tail}`, "utf8");
console.log(`Prom corrected feed: source_offers=${offers.length}, output_offers=${outOffers.length}, allowlist=${dropshipCodes.size}, matched=${matched}, available=${available}, unavailable=${unavailable}, own_skipped=${ownSkipped}, no_article=${noArticle}`);
console.log(`Wrote ${OUT_FILE}`);

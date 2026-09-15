import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const FEED_FILE = "_site/feed.xml";
const STATS_FILE = "_site/stats.json";
const SOURCE_URL = String(process.env.PROM_SOURCE_URL || "").trim();

if (!SOURCE_URL) throw new Error("PROM_SOURCE_URL is missing");
if (!existsSync(FEED_FILE)) throw new Error(`Missing ${FEED_FILE}`);

const COLLAR_WORDS = [
  "collar",
  "waudog",
  "waucat",
  "evolutor",
  "dog extreme",
  "dog extremе",
  "airyvest",
  "puller",
  "liker",
  "flyber",
  "pitchdog",
  "superium",
  "supercat",
  "gigwi",
  "pet's lab",
  "pets lab",
  "pet’s lab",
  "teremok",
];

function unwrap(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[/i, "")
    .replace(/\]\]>$/i, "")
    .trim();
}

function getTagValue(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? unwrap(m[1]) : null;
}

function getOfferId(xml) {
  const m = xml.match(/<offer\b[^>]*\bid=(["'])([^"']+)\1/i);
  return m ? String(m[2]).trim() : "";
}

function setMainPrice(xml, value) {
  const re = /(<price\b[^>]*>)[\s\S]*?(<\/price>)/i;
  if (re.test(xml)) {
    return xml.replace(re, (full, openTag, closeTag) => `${openTag}${value}${closeTag}`);
  }
  return xml.replace(/(<offer\b[^>]*>)/i, `$1<price>${value}</price>`);
}

function parsePrice(value) {
  const n = Number(String(value || "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function loadCollarArticles() {
  const out = new Set();
  for (const file of ["collar-current-vendorcodes.gz.b64", "collar-dropship-vendorcodes.gz.b64"]) {
    if (!existsSync(file)) continue;
    try {
      const packed = readFileSync(file, "utf8").trim();
      const raw = gunzipSync(Buffer.from(packed, "base64")).toString("utf8").trim();
      let values = [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) values = parsed;
        else if (parsed && typeof parsed === "object") values = Object.keys(parsed);
      } catch {
        values = raw.split(/[\r\n,;\t]+/g);
      }
      for (const value of values) {
        const key = normalizeKey(value);
        if (key) out.add(key);
      }
    } catch (error) {
      console.warn(`Could not read ${file}: ${error?.message || error}`);
    }
  }
  return out;
}

const COLLAR_ARTICLES = loadCollarArticles();

function isCollarFamily(sourceOffer) {
  const vendor = normalizeKey(getTagValue(sourceOffer, "vendor"));
  const name = normalizeKey(
    getTagValue(sourceOffer, "name_ua") || getTagValue(sourceOffer, "name") || ""
  );
  const article = normalizeKey(getTagValue(sourceOffer, "article"));

  if (article && COLLAR_ARTICLES.has(article)) return true;
  if (vendor === "collar" || vendor === "collar company") return true;
  return COLLAR_WORDS.some((word) => vendor.includes(word) || name.includes(word));
}

function addUnique(map, key, offer) {
  key = normalizeKey(key);
  if (!key) return;
  if (!map.has(key)) map.set(key, offer);
  else if (map.get(key) !== offer) map.set(key, null);
}

const sourceResponse = await fetch(SOURCE_URL, {
  headers: {
    "User-Agent": "D&D-Home-Pets-Rozetka-Price-Rules/1.0",
    "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
  },
});
if (!sourceResponse.ok) {
  throw new Error(`Prom XML error: ${sourceResponse.status} ${sourceResponse.statusText}`);
}
const sourceXml = await sourceResponse.text();
const sourceOffers = sourceXml.match(/<offer\b[\s\S]*?<\/offer>/gi) || [];

const byId = new Map();
const byUrl = new Map();
const byArticle = new Map();
for (const offer of sourceOffers) {
  const id = getOfferId(offer);
  if (id) byId.set(id, offer);
  addUnique(byUrl, getTagValue(offer, "url"), offer);
  addUnique(byArticle, getTagValue(offer, "article"), offer);
}

function findSourceOffer(finalOffer) {
  const id = getOfferId(finalOffer);
  if (id && byId.has(id)) return { offer: byId.get(id), matchedBy: "id" };

  const url = normalizeKey(getTagValue(finalOffer, "url"));
  if (url && byUrl.get(url)) return { offer: byUrl.get(url), matchedBy: "url" };

  const article = normalizeKey(getTagValue(finalOffer, "article"));
  if (article && byArticle.get(article)) return { offer: byArticle.get(article), matchedBy: "article" };

  return { offer: null, matchedBy: null };
}

const finalXml = await readFile(FEED_FILE, "utf8");
const stats = {
  source_offers: sourceOffers.length,
  final_offers: 0,
  matched_by_id: 0,
  matched_by_url: 0,
  matched_by_article: 0,
  unmatched: 0,
  invalid_source_price: 0,
  collar_no_markup: 0,
  non_collar_marked_up: 0,
  changed_prices: 0,
};

const correctedXml = finalXml.replace(/<offer\b[\s\S]*?<\/offer>/gi, (finalOffer) => {
  stats.final_offers++;
  const found = findSourceOffer(finalOffer);
  if (!found.offer) {
    stats.unmatched++;
    return finalOffer;
  }
  stats[`matched_by_${found.matchedBy}`]++;

  // IMPORTANT: the business-price base is the CURRENT Prom <price>.
  // oldprice / price_old / price_promo must never replace it.
  const baseRaw = getTagValue(found.offer, "price");
  const base = parsePrice(baseRaw);
  if (base === null) {
    stats.invalid_source_price++;
    return finalOffer;
  }

  let targetPrice;
  if (isCollarFamily(found.offer)) {
    stats.collar_no_markup++;
    targetPrice = String(baseRaw).replace(/\s/g, "").replace(",", ".");
  } else {
    const pct = base <= 500 ? 0.07 : base <= 1500 ? 0.05 : 0.03;
    targetPrice = String(Math.round(base * (1 + pct)));
    stats.non_collar_marked_up++;
  }

  const current = getTagValue(finalOffer, "price");
  if (String(current || "").trim() !== targetPrice) stats.changed_prices++;
  return setMainPrice(finalOffer, targetPrice);
});

await writeFile(FEED_FILE, correctedXml, "utf8");

let allStats = {};
try {
  allStats = JSON.parse(await readFile(STATS_FILE, "utf8"));
} catch {}
allStats.price_rules = stats;
await writeFile(STATS_FILE, JSON.stringify(allStats, null, 2) + "\n", "utf8");

console.log("Rozetka price rules applied:", JSON.stringify(stats, null, 2));

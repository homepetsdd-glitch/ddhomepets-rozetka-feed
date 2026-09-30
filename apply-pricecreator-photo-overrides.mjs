import fs from "node:fs";

const FEED_FILE = "_site/feed.xml";
const OVERRIDES_FILE = "pricecreator-photo-overrides.json";
const STATS_FILE = "_site/stats.json";

if (!fs.existsSync(FEED_FILE)) throw new Error("Missing final feed");
if (!fs.existsSync(OVERRIDES_FILE)) {
  console.log("No Pricecreator photo overrides file; nothing to do.");
  process.exit(0);
}

const overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf8"));
let xml = fs.readFileSync(FEED_FILE, "utf8");
let applied = 0;
let missing = 0;

function getOfferId(offer) {
  const m = offer.match(/<offer\b[^>]*\bid=(["'])([^"']+)\1/i);
  return m ? m[2].trim() : "";
}
function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function replacePictures(offer, pictures) {
  const clean = [...new Set((pictures || []).map(x => String(x || "").trim()).filter(Boolean))];
  if (!clean.length) return offer;
  const tags = clean.map(url => `<picture>${escapeXml(url)}</picture>`).join("\n    ");
  const re = /\s*<picture\b[^>]*>[\s\S]*?<\/picture>/gi;
  const first = offer.search(re);
  if (first >= 0) {
    const stripped = offer.replace(re, "");
    return stripped.slice(0, first) + "\n    " + tags + stripped.slice(first);
  }
  return offer.replace(/<\/offer>/i, `    ${tags}\n  </offer>`);
}

const wanted = new Set(Object.keys(overrides));
xml = xml.replace(/<offer\b[\s\S]*?<\/offer>/gi, offer => {
  const id = getOfferId(offer);
  if (!wanted.has(id)) return offer;
  applied++;
  return replacePictures(offer, overrides[id]);
});
missing = wanted.size - applied;

if (missing) throw new Error(`Pricecreator photo override safety stop: ${missing} OFFERID(s) missing from final feed`);

fs.writeFileSync(FEED_FILE, xml, "utf8");
if (fs.existsSync(STATS_FILE)) {
  const stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
  stats.pricecreator_photo_overrides = applied;
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2) + "\n", "utf8");
}
console.log(`Pricecreator photo overrides applied: ${applied}`);

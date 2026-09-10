import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const RESTORE_IDS_FILE = "restore-offerids.txt";
const SOURCE_FILE = "generate-feed.mjs";
const TEMP_FILE = ".generate-feed-with-restores.tmp.mjs";
const LATEST_CHOICES_B64_FILE = "collar-photo-choices.latest.json.gz.b64";

// Rebuild the latest reviewed Collar photo choices before generating the feed.
// The compact gzip+base64 payload keeps the repository file small while preserving
// the exact JSON selected during review.
if (fs.existsSync(LATEST_CHOICES_B64_FILE)) {
  const encoded = fs.readFileSync(LATEST_CHOICES_B64_FILE, "utf8").trim();
  const choicesText = gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
  JSON.parse(choicesText);
  fs.writeFileSync("collar-photo-choices.json", choicesText, "utf8");
}

const restoreText = fs.readFileSync(RESTORE_IDS_FILE, "utf8");
const restoreIds = [...new Set(
  restoreText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^\d{10}$/.test(line))
)];

if (restoreIds.length !== 26) {
  throw new Error(`Safety stop: expected 26 restore OFFERIDs, found ${restoreIds.length}`);
}

let source = fs.readFileSync(SOURCE_FILE, "utf8");

const thresholdMarker = "const AUTO_NEW_AFTER_PROM_ID = 3166628631;";
const whitelistMarker = "const isWhitelisted = whitelist.has(targetId);";

if (!source.includes(thresholdMarker)) {
  throw new Error("Safety stop: AUTO_NEW_AFTER_PROM_ID marker not found");
}
if ((source.match(/const isWhitelisted = whitelist\.has\(targetId\);/g) || []).length !== 1) {
  throw new Error("Safety stop: expected exactly one whitelist marker");
}

const restoreLiteral = JSON.stringify(restoreIds);
source = source.replace(
  thresholdMarker,
  `${thresholdMarker}\n\n// Verified restore list: active in Pricecreator and present in fresh Prom export.\nconst RESTORE_OFFER_IDS = new Set(${restoreLiteral});`
);
source = source.replace(
  whitelistMarker,
  "const isWhitelisted = whitelist.has(targetId) || RESTORE_OFFER_IDS.has(targetId);"
);

// SuperCat is supplied through COLLAR Company, so it must use the Prom price with no Rozetka markup.
const markupStart = source.indexOf("function applyRozetkaMarkup");
const collarPriceMarker = '  "superium"\n];';
const collarPriceMarkerIndex = markupStart >= 0
  ? source.indexOf(collarPriceMarker, markupStart)
  : -1;

if (collarPriceMarkerIndex < 0) {
  throw new Error("Safety stop: COLLAR price family marker not found");
}

source =
  source.slice(0, collarPriceMarkerIndex) +
  '  "superium",\n  "supercat"\n];' +
  source.slice(collarPriceMarkerIndex + collarPriceMarker.length);

// Photo-review gallery: after the old PHOTO_FIX batch is reviewed,
// continue with every unreviewed COLLAR-family product instead of filtering
// the report down to PHOTO_FIX only. Existing manual choices stay excluded.
const reportStart = source.indexOf("async function buildCollarPhotoReport()");
const reportEnd = reportStart >= 0
  ? source.indexOf("function escapeHtml", reportStart)
  : -1;

if (reportStart < 0 || reportEnd < 0) {
  throw new Error("Safety stop: COLLAR photo report function not found");
}

let reportSource = source.slice(reportStart, reportEnd);
const photoFixOnlyMarker = `    // Нас зараз цікавлять тільки товари зі старого PHOTO_FIX\n    if (!photoFixSet.has(String(targetId))) continue;\n`;
if (!reportSource.includes(photoFixOnlyMarker)) {
  throw new Error("Safety stop: PHOTO_FIX-only report marker not found");
}
reportSource = reportSource.replace(
  photoFixOnlyMarker,
  `    // Показуємо всі ще не перевірені товари COLLAR-family, не лише старий PHOTO_FIX.\n`
);

const photoFixTargetMarker = "      photo_fix_target: true,";
if ((reportSource.match(/photo_fix_target: true,/g) || []).length !== 1) {
  throw new Error("Safety stop: expected one photo_fix_target marker in report");
}
reportSource = reportSource.replace(
  photoFixTargetMarker,
  "      photo_fix_target: photoFixSet.has(String(targetId)),"
);

source = source.slice(0, reportStart) + reportSource + source.slice(reportEnd);

fs.writeFileSync(TEMP_FILE, source, "utf8");

try {
  await import(pathToFileURL(`${process.cwd()}/${TEMP_FILE}`).href + `?t=${Date.now()}`);
} finally {
  try { fs.unlinkSync(TEMP_FILE); } catch {}
}

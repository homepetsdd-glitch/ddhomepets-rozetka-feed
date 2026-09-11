import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const RESTORE_IDS_FILE = "restore-offerids.txt";
const SOURCE_FILE = "generate-feed.mjs";
const TEMP_FILE = ".generate-feed-with-restores.tmp.mjs";
const LATEST_CHOICES_B64_FILE = "collar-photo-choices.latest.json.gz.b64";
const EXTRA_CHOICES_FILE = "collar-photo-choices-extra.json";
const ROZETKA_VARIANTS_FIRST_REMOVE_IDS = new Set([
  "3165828775",
  "3165828759",
  "3165828758",
  "3163433466",
  "3165828756",
  "3162334739",
  "3163415738",
  "3165828773",
]);

// Rebuild the latest reviewed Collar photo choices before generating the feed.
// The compact gzip+base64 payload keeps the repository file small while preserving
// the exact JSON selected during review.
if (fs.existsSync(LATEST_CHOICES_B64_FILE)) {
  const encoded = fs.readFileSync(LATEST_CHOICES_B64_FILE, "utf8").trim();
  const choicesText = gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
  const latestChoices = JSON.parse(choicesText);
  const extraChoices = fs.existsSync(EXTRA_CHOICES_FILE)
    ? JSON.parse(fs.readFileSync(EXTRA_CHOICES_FILE, "utf8"))
    : {};
  const mergedChoices = { ...latestChoices, ...extraChoices };
  fs.writeFileSync(
    "collar-photo-choices.json",
    JSON.stringify(mergedChoices, null, 2) + "\n",
    "utf8"
  );
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
  `${thresholdMarker}\n\n// Verified restore list: active in Pricecreator and present in fresh Prom export.\nconst RESTORE_OFFER_IDS = new Set(${restoreLiteral});\n\n// Rozetka confirmation: these 8 COLLAR-family products have an assortment/variants image first.\nconst ROZETKA_VARIANTS_FIRST_REMOVE_IDS = new Set(${JSON.stringify([...ROZETKA_VARIANTS_FIRST_REMOVE_IDS])});`
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

// Full Collar photo audit: show every current COLLAR-family product again,
// including products reviewed earlier. Previous choices are only suggestions;
// the gallery must use the current source photo order so changed supplier photos
// can be checked again against the fresh Rozetka assortment.
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
  `    // Повний аудит: показуємо весь актуальний COLLAR-family, не лише PHOTO_FIX.\n`
);

const reportWhitelistMarker = `    // Беремо тільки товари, які реально входять у каталог Rozetka\n    if (!whitelist.has(String(targetId))) continue;`;
if (!reportSource.includes(reportWhitelistMarker)) {
  throw new Error("Safety stop: COLLAR report whitelist marker not found");
}
reportSource = reportSource.replace(
  reportWhitelistMarker,
  `    // Беремо всі товари, які потрапляють у поточний фід Rozetka:\n    // whitelist + перевірені restore + нові Prom-картки після контрольного ID.\n    const sourceIdNumberForReport = Number(sourceId);\n    const isCurrentFeedProductForReport =\n      whitelist.has(String(targetId)) ||\n      RESTORE_OFFER_IDS.has(String(targetId)) ||\n      (Number.isSafeInteger(sourceIdNumberForReport) && sourceIdNumberForReport > AUTO_NEW_AFTER_PROM_ID);\n    if (!isCurrentFeedProductForReport) continue;`
);

const reviewedSkipMarker = `    // Старі товари, які вже вручну перевірені, вдруге не показуємо\n    if (collarPhotoChoices[String(targetId)]) continue;\n`;
if (!reportSource.includes(reviewedSkipMarker)) {
  throw new Error("Safety stop: reviewed Collar skip marker not found");
}
reportSource = reportSource.replace(
  reviewedSkipMarker,
  `    // Раніше перевірені товари теж показуємо повторно: фото постачальника могли змінитися.\n`
);

const photoFixTargetMarker = "      photo_fix_target: true,";
if ((reportSource.match(/photo_fix_target: true,/g) || []).length !== 1) {
  throw new Error("Safety stop: expected one photo_fix_target marker in report");
}
reportSource = reportSource.replace(
  photoFixTargetMarker,
  "      photo_fix_target: photoFixSet.has(String(targetId)) || ROZETKA_VARIANTS_FIRST_REMOVE_IDS.has(String(targetId)),"
);

const manualChoiceMarker = "      manual_choice: false,";
if ((reportSource.match(/manual_choice: false,/g) || []).length !== 1) {
  throw new Error("Safety stop: expected one manual_choice marker in report");
}
reportSource = reportSource.replace(
  manualChoiceMarker,
  "      manual_choice: Boolean(collarPhotoChoices[String(targetId)]),"
);

source = source.slice(0, reportStart) + reportSource + source.slice(reportEnd);

// Treat the 8 Rozetka-confirmed assortment/variants-first products as first-photo fixes
// in the main feed, so photo #1 is removed even before a manual gallery choice exists.
const isPhotoFixTargetMarker = "const isPhotoFixTarget = photoFixSet.has(targetId);";
if ((source.match(/const isPhotoFixTarget = photoFixSet\.has\(targetId\);/g) || []).length !== 1) {
  throw new Error("Safety stop: expected exactly one main isPhotoFixTarget marker");
}
source = source.replace(
  isPhotoFixTargetMarker,
  "const isPhotoFixTarget = photoFixSet.has(targetId) || ROZETKA_VARIANTS_FIRST_REMOVE_IDS.has(String(targetId));"
);

// For items explicitly marked review="problem", remove the original first photo
// whenever a different main photo was selected. This prevents assortment/variant
// collages from remaining later in the Rozetka gallery after reordering.
const removeOriginalFirstMarker = `  const removeOriginalFirst =\n    isPhotoFixTarget &&\n    Number(collarPhotoChoice.main_photo || 0) !== 1;`;
if ((source.match(/const removeOriginalFirst =/g) || []).length !== 1 || !source.includes(removeOriginalFirstMarker)) {
  throw new Error("Safety stop: removeOriginalFirst marker not found");
}
source = source.replace(
  removeOriginalFirstMarker,
  `  const removeOriginalFirst =\n    (isPhotoFixTarget || String(collarPhotoChoice.review || "").toLowerCase() === "problem") &&\n    Number(collarPhotoChoice.main_photo || 0) !== 1;`
);

fs.writeFileSync(TEMP_FILE, source, "utf8");

try {
  await import(pathToFileURL(`${process.cwd()}/${TEMP_FILE}`).href + `?t=${Date.now()}`);
} finally {
  try { fs.unlinkSync(TEMP_FILE); } catch {}
}

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const RESTORE_IDS_FILE = "restore-offerids.txt";
const SOURCE_FILE = "generate-feed.mjs";
const TEMP_FILE = ".generate-feed-with-restores.tmp.mjs";

const restoreText = fs.readFileSync(RESTORE_IDS_FILE, "utf8");
const restoreIds = [...new Set(restoreText.match(/\b\d{10}\b/g) || [])];

if (restoreIds.length !== 161) {
  throw new Error(`Safety stop: expected 161 restore OFFERIDs, found ${restoreIds.length}`);
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

fs.writeFileSync(TEMP_FILE, source, "utf8");

try {
  await import(pathToFileURL(`${process.cwd()}/${TEMP_FILE}`).href + `?t=${Date.now()}`);
} finally {
  try { fs.unlinkSync(TEMP_FILE); } catch {}
}

import fs from "node:fs";

const WRAPPER_FILE = "run-generate-with-restores.mjs";
const IDS_FILE = "rozetka-collar-audit-extra-offerids.txt";

if (!fs.existsSync(WRAPPER_FILE) || !fs.existsSync(IDS_FILE)) {
  throw new Error("Fresh Collar audit prep: required files are missing");
}

const ids = [...new Set(
  fs.readFileSync(IDS_FILE, "utf8")
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(x => /^\d{10}$/.test(x))
)];

if (ids.length !== 294) {
  throw new Error(`Fresh Collar audit prep: expected 294 IDs, found ${ids.length}`);
}

let source = fs.readFileSync(WRAPPER_FILE, "utf8");

const countOld = "if (rozetkaCollarAuditExtraIds.length !== 43) {\n  throw new Error(`Safety stop: expected 43 fresh Rozetka Collar audit extras, found ${rozetkaCollarAuditExtraIds.length}`);\n}";
const countNew = `if (rozetkaCollarAuditExtraIds.length !== ${ids.length}) {\n  throw new Error(\`Safety stop: expected ${ids.length} fresh Rozetka Collar audit extras, found \${rozetkaCollarAuditExtraIds.length}\`);\n}`;
if (!source.includes(countOld)) {
  throw new Error("Fresh Collar audit prep: expected-count marker not found");
}
source = source.replace(countOld, countNew);

const whitelistOld = '  "const isWhitelisted = whitelist.has(targetId) || RESTORE_OFFER_IDS.has(targetId);"';
const whitelistNew = '  "const isWhitelisted = whitelist.has(targetId) || RESTORE_OFFER_IDS.has(targetId) || ROZETKA_COLLAR_AUDIT_EXTRA_IDS.has(String(targetId));"';
if (!source.includes(whitelistOld)) {
  throw new Error("Fresh Collar audit prep: whitelist replacement marker not found");
}
source = source.replace(whitelistOld, whitelistNew);

const reportOld = "      RESTORE_OFFER_IDS.has(String(targetId)) ||\\n      (Number.isSafeInteger(sourceIdNumberForReport) && sourceIdNumberForReport > AUTO_NEW_AFTER_PROM_ID);\\n";
const reportNew = "      RESTORE_OFFER_IDS.has(String(targetId)) ||\\n      ROZETKA_COLLAR_AUDIT_EXTRA_IDS.has(String(targetId)) ||\\n      (Number.isSafeInteger(sourceIdNumberForReport) && sourceIdNumberForReport > AUTO_NEW_AFTER_PROM_ID);\\n";
if (!source.includes(reportOld)) {
  throw new Error("Fresh Collar audit prep: report whitelist marker not found");
}
source = source.replace(reportOld, reportNew);

fs.writeFileSync(WRAPPER_FILE, source, "utf8");
console.log(`Fresh Collar audit prep: enabled ${ids.length} current Pricecreator Collar IDs for feed + gallery review`);

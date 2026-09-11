import fs from "node:fs";

const FEED_FILE = "_site/feed.xml";
const GALLERY_FILE = "_site/collar-photo-gallery.html";
const STATS_FILE = "_site/stats.json";
const CHOICES_FILE = "collar-photo-choices-extra.json";

// Exact original Prom photo positions confirmed manually during the full Collar audit.
// Positions are based on the current supplier photo order before any reordering.
const REMOVE_POSITIONS = Object.freeze({
  "3139690769": [1],
  "3140239793": [2],
  "3140950101": [1],
  "3141597247": [2],
  "3143851017": [1, 2],
  "3143851704": [1, 4],
  "3161289299": [1],
  "3162323364": [1],
  "3162333843": [1],
  "3162333886": [1],
  "3162334024": [1],
  "3162343753": [1],
  "3163415698": [1],
  "3163415732": [1],
  "3163416384": [1],
  "3163416385": [1],
  "3163427230": [1],
  "3165828752": [1],
  "3165828760": [1],
  "3165828769": [1],
  "3183073327": [1],
  "3183073328": [1],
  "3186793190": [1],
  "3191491871": [1],
  "3175112954": [1],
  "3175112960": [1],
  "3181448373": [1]
});

function offerId(xml) {
  const m = xml.match(/<offer\b[^>]*\bid=["']([^"']+)["']/i);
  return m ? m[1] : "";
}

function unwrap(inner = "") {
  return String(inner)
    .replace(/^<!\[CDATA\[/i, "")
    .replace(/\]\]>$/i, "")
    .trim();
}

function normalizeUrl(value) {
  const raw = unwrap(value);
  try {
    const u = new URL(raw);
    const parts = decodeURIComponent(u.pathname).split("/").filter(Boolean);
    const fileName = parts.at(-1) || "";
    if (u.hostname.toLowerCase() === "images.prom.ua" && fileName) {
      return `https://images.prom.ua/${encodeURI(fileName)}`;
    }
    return raw;
  } catch {
    return raw;
  }
}

function normalizePictureTag(tag) {
  return tag.replace(
    /(<picture\b[^>]*>)([\s\S]*?)(<\/picture>)/i,
    (full, openTag, inner, closeTag) => `${openTag}${normalizeUrl(inner)}${closeTag}`
  );
}

function pictureKey(tag) {
  const m = tag.match(/<picture\b[^>]*>([\s\S]*?)<\/picture>/i);
  const value = normalizeUrl(m ? m[1] : "");
  try {
    const u = new URL(value);
    const parts = decodeURIComponent(u.pathname).split("/").filter(Boolean);
    return (parts.at(-1) || value).toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function replacePictures(feedOffer, orderedTags) {
  const pictureRegex = /<picture\b[^>]*>[\s\S]*?<\/picture>/gi;
  const firstIndex = feedOffer.search(pictureRegex);
  if (firstIndex < 0) return feedOffer;
  const without = feedOffer.replace(pictureRegex, "");
  return without.slice(0, firstIndex) + orderedTags.join("\n") + without.slice(firstIndex);
}

if (!fs.existsSync(FEED_FILE) || !fs.existsSync(CHOICES_FILE)) {
  throw new Error("Audit photo removals: required files are missing");
}

const sourceUrl = String(process.env.PROM_SOURCE_URL || "").trim();
if (!sourceUrl) throw new Error("Audit photo removals: PROM_SOURCE_URL is missing");

const sourceResponse = await fetch(sourceUrl);
if (!sourceResponse.ok) throw new Error(`Audit photo removals: source XML HTTP ${sourceResponse.status}`);
const sourceXml = await sourceResponse.text();
const feedXml = fs.readFileSync(FEED_FILE, "utf8");
const choices = JSON.parse(fs.readFileSync(CHOICES_FILE, "utf8"));

const sourceById = new Map();
for (const m of sourceXml.matchAll(/<offer\b[\s\S]*?<\/offer>/gi)) {
  const xml = m[0];
  const id = offerId(xml);
  if (id && REMOVE_POSITIONS[id]) sourceById.set(id, xml);
}

// Some audited offers can disappear from the final Rozetka feed (for example because
// the source marks them unavailable or another feed rule excludes them). Those must not
// block publishing. Safety is enforced only for audited offers that are actually present
// in this build's final feed.
const activeTargetIds = new Set();
for (const m of feedXml.matchAll(/<offer\b[\s\S]*?<\/offer>/gi)) {
  const id = offerId(m[0]);
  if (id && REMOVE_POSITIONS[id]) activeTargetIds.add(id);
}
const inactiveTargetIds = Object.keys(REMOVE_POSITIONS).filter(id => !activeTargetIds.has(id));

const correctedIds = new Set();
let removedPictures = 0;
let missingSource = 0;
let missingChoice = 0;

const updatedFeed = feedXml.replace(/<offer\b[\s\S]*?<\/offer>/gi, (feedOffer) => {
  const id = offerId(feedOffer);
  const remove = REMOVE_POSITIONS[id];
  if (!remove) return feedOffer;

  const sourceOffer = sourceById.get(id);
  if (!sourceOffer) {
    missingSource++;
    return feedOffer;
  }

  const choice = choices[id];
  if (!choice) {
    missingChoice++;
    return feedOffer;
  }

  const sourcePictures = sourceOffer.match(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi) || [];
  const removeSet = new Set(remove.map(Number));
  const indexed = sourcePictures
    .map((tag, index) => ({ tag: normalizePictureTag(tag), position: index + 1 }))
    .filter(item => !removeSet.has(item.position));

  removedPictures += sourcePictures.length - indexed.length;

  const mainPos = Number(choice.main_photo || 0);
  const endPos = Number(choice.end_photo || 0);
  const main = indexed.find(x => x.position === mainPos) || null;
  const end = endPos > 0 && endPos !== mainPos
    ? indexed.find(x => x.position === endPos) || null
    : null;

  const middle = indexed.filter(x => {
    if (main && x.position === main.position) return false;
    if (end && x.position === end.position) return false;
    return true;
  });

  const ordered = [];
  if (main) ordered.push(main);
  ordered.push(...middle);
  if (end) ordered.push(end);

  // Safety: remove duplicate source URLs after canonicalization.
  const seen = new Set();
  const orderedTags = [];
  for (const item of ordered) {
    const key = pictureKey(item.tag);
    if (seen.has(key)) continue;
    seen.add(key);
    orderedTags.push(item.tag);
  }

  if (!orderedTags.length) return feedOffer;
  correctedIds.add(id);
  return replacePictures(feedOffer, orderedTags);
});

fs.writeFileSync(FEED_FILE, updatedFeed, "utf8");

if (fs.existsSync(STATS_FILE)) {
  const stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
  stats.audit_photo_items_corrected = correctedIds.size;
  stats.audit_photo_positions_removed = removedPictures;
  stats.audit_photo_missing_source = missingSource;
  stats.audit_photo_missing_choice = missingChoice;
  stats.audit_photo_targets_in_feed = activeTargetIds.size;
  stats.audit_photo_targets_not_in_feed = inactiveTargetIds.length;
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2) + "\n", "utf8");
}

// Keep the audit gallery consistent with the feed: hide the exact confirmed-bad
// original positions by their visible "Фото №N" labels. This runs after the existing
// auto-suggestion script, so it does not shift any other photo number.
if (fs.existsSync(GALLERY_FILE)) {
  let html = fs.readFileSync(GALLERY_FILE, "utf8");
  const payload = JSON.stringify(REMOVE_POSITIONS).replace(/</g, "\\u003c");
  const inject = `\n<script>\n(() => {\n  const removeMap = ${payload};\n  document.addEventListener('DOMContentLoaded', () => {\n    for (const [id, positions] of Object.entries(removeMap)) {\n      const card = document.querySelector('.card[data-id="' + id + '"]');\n      if (!card) continue;\n      const wanted = new Set(positions.map(Number));\n      card.querySelectorAll('.photo').forEach(photo => {\n        const label = photo.querySelector('.position')?.textContent || '';\n        const m = label.match(/№\\s*(\\d+)/);\n        const pos = m ? Number(m[1]) : 0;\n        if (wanted.has(pos)) photo.style.display = 'none';\n      });\n      const info = card.querySelector('.info');\n      if (info) {\n        const note = document.createElement('div');\n        note.style.marginTop = '6px';\n        note.style.fontWeight = 'bold';\n        note.style.color = '#a00';\n        note.textContent = '🗑 Підтверджено видалення фото: ' + positions.map(n => '№' + n).join(', ');\n        info.appendChild(note);\n      }\n    }\n  });\n})();\n</script>\n`;
  const bodyIndex = html.lastIndexOf("</body>");
  if (bodyIndex >= 0) {
    html = html.slice(0, bodyIndex) + inject + html.slice(bodyIndex);
    fs.writeFileSync(GALLERY_FILE, html, "utf8");
  }
}

if (correctedIds.size !== activeTargetIds.size || missingSource || missingChoice) {
  throw new Error(
    `Audit photo removals safety stop: corrected ${correctedIds.size}/${activeTargetIds.size} active feed targets; ` +
    `missing source=${missingSource}; missing choice=${missingChoice}; not in feed=${inactiveTargetIds.length}`
  );
}

console.log(
  `Audit photo removals: corrected=${correctedIds.size}/${activeTargetIds.size} active feed targets; ` +
  `removed=${removedPictures}; missing source=${missingSource}; missing choice=${missingChoice}; ` +
  `not in feed=${inactiveTargetIds.length}`
);
if (inactiveTargetIds.length) {
  console.log(`Audit photo removals: skipped because not in final feed: ${inactiveTargetIds.join(',')}`);
}

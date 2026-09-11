import fs from "node:fs";

const REPORT_FILE = "_site/collar-photo-report.json";
const CHOICES_FILE = "collar-photo-choices.json";
const FEED_FILE = "_site/feed.xml";
const GALLERY_FILE = "_site/collar-photo-gallery.html";
const OUT_FILE = "_site/collar-photo-suggestions.json";

function decodeXml(s = "") {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? decodeXml(m[1]).trim() : "";
}

function offerId(xml) {
  const m = xml.match(/<offer\b[^>]*\bid=["']([^"']+)["']/i);
  return m ? m[1] : "";
}

function normalizeText(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[«»“”„"'`’]/g, " ")
    .replace(/[()\[\]{},.:;!?/\\|+_=–—-]/g, " ")
    .replace(/\b(?:xxxs|xxs|xxl|xxxl|xs|xl|s|m|l)\b/gi, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:мм|см|м|кг|г|л|ml|kg|cm|mm)\b/gi, " ")
    .replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "для","та","і","й","з","зі","із","у","в","на","до","по","від","під","над","про",
  "собак","собаки","котів","кота","кішок","тварин","розмір","колір","кольору","оригінал",
  "черный","чорний","білий","белый","сірий","серый","рожевий","розовый","червоний","красный",
  "синій","синий","зелений","зеленый","помаранчевий","оранжевый","бежевий","бежевый"
]);

function tokens(s) {
  return normalizeText(s).split(" ").filter(x => x.length > 1 && !STOP.has(x));
}

function similarity(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  const jaccard = union ? inter / union : 0;
  const containment = inter / Math.min(A.size, B.size);
  return 0.65 * containment + 0.35 * jaccard;
}

function escJsJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

if (!fs.existsSync(REPORT_FILE) || !fs.existsSync(CHOICES_FILE) || !fs.existsSync(FEED_FILE) || !fs.existsSync(GALLERY_FILE)) {
  throw new Error("Suggestion builder: required generated files are missing");
}

const report = JSON.parse(fs.readFileSync(REPORT_FILE, "utf8"));
const choices = JSON.parse(fs.readFileSync(CHOICES_FILE, "utf8"));
const feed = fs.readFileSync(FEED_FILE, "utf8");

const meta = new Map();
for (const m of feed.matchAll(/<offer\b[\s\S]*?<\/offer>/gi)) {
  const xml = m[0];
  const id = offerId(xml);
  if (!id) continue;
  meta.set(id, {
    id,
    name: tag(xml, "name_ua") || tag(xml, "name"),
    vendor: (tag(xml, "vendor") || "").toLowerCase(),
  });
}

const reviewed = [];
for (const [id, choice] of Object.entries(choices)) {
  const m = meta.get(String(id));
  if (!m) continue;
  if (!choice || (!choice.main_photo && !choice.end_photo)) continue;
  reviewed.push({ ...m, choice });
}

const suggestions = {};
for (const item of report) {
  const targetName = item.name || "";
  const targetVendor = String(item.vendor || "").toLowerCase();
  let best = null;

  for (const src of reviewed) {
    let score = similarity(targetName, src.name);
    if (targetVendor && src.vendor && targetVendor === src.vendor) score += 0.08;
    if (score > 1) score = 1;
    if (!best || score > best.score) best = { src, score };
  }

  if (!best || best.score < 0.72) continue;

  const main = Number(best.src.choice.main_photo || 0) || null;
  const end = Number(best.src.choice.end_photo || 0) || null;
  const count = Number(item.pictures_count || 0);
  if (main && main > count) continue;
  const safeEnd = end && end <= count && end !== main ? end : null;

  suggestions[String(item.rozetka_offer_id)] = {
    main_photo: main,
    end_photo: safeEnd,
    source_id: best.src.id,
    source_name: best.src.name,
    confidence: Math.round(best.score * 100)
  };
}

fs.writeFileSync(OUT_FILE, JSON.stringify(suggestions, null, 2) + "\n", "utf8");

let html = fs.readFileSync(GALLERY_FILE, "utf8");
const payload = escJsJson(suggestions);
const inject = `\n<script>\n(() => {\n  const suggestions = ${payload};\n  function applyVisual(card, kind, position) {\n    if (!position) return;\n    const photos = card.querySelectorAll('.photo');\n    const photo = photos[Number(position) - 1];\n    if (!photo) return;\n    photo.classList.add(kind === 'main' ? 'selected-main' : 'selected-end');\n    card.dataset[kind === 'main' ? 'mainPhoto' : 'endPhoto'] = String(position);\n  }\n  document.addEventListener('DOMContentLoaded', () => {\n    let applied = 0;\n    document.querySelectorAll('.card').forEach(card => {\n      const id = card.dataset.id;\n      const s = suggestions[id];\n      if (!s) return;\n\n      const savedMain = localStorage.getItem('collar_main_photo_' + id);\n      const savedEnd = localStorage.getItem('collar_end_photo_' + id);\n      const savedReview = localStorage.getItem('collar_review_' + id);\n      if (savedMain || savedEnd || savedReview) return;\n\n      if (s.main_photo) {\n        localStorage.setItem('collar_main_photo_' + id, String(s.main_photo));\n        applyVisual(card, 'main', s.main_photo);\n      }\n      if (s.end_photo) {\n        localStorage.setItem('collar_end_photo_' + id, String(s.end_photo));\n        applyVisual(card, 'end', s.end_photo);\n      }\n      localStorage.setItem('collar_review_' + id, 'auto');\n      card.dataset.review = 'auto';\n\n      const info = card.querySelector('.info');\n      if (info) {\n        const box = document.createElement('div');\n        box.style.marginTop = '8px';\n        box.style.padding = '7px 9px';\n        box.style.background = '#fff3b0';\n        box.style.border = '1px solid #d7b400';\n        box.innerHTML = '🤖 Автопідбір: головне №' + (s.main_photo || '—') +\n          (s.end_photo ? ', в кінець №' + s.end_photo : '') +\n          ' · схожість ' + s.confidence + '%<br><small>За зразком: ' + s.source_name + '</small>';\n        info.appendChild(box);\n      }\n      applied++;\n    });\n\n    const filters = document.querySelector('.filters');\n    if (filters) {\n      const badge = document.createElement('span');\n      badge.style.marginLeft = '10px';\n      badge.style.fontWeight = 'bold';\n      badge.textContent = '🤖 Автопідбір застосовано: ' + applied;\n      filters.appendChild(badge);\n    }\n  });\n})();\n<\/script>\n`;

html = html.replace(/<\/body>\s*<\/html>\s*$/i, inject + "</body>\n</html>");
fs.writeFileSync(GALLERY_FILE, html, "utf8");

console.log(`Collar photo suggestions: ${Object.keys(suggestions).length} high-confidence suggestions from ${reviewed.length} reviewed products`);

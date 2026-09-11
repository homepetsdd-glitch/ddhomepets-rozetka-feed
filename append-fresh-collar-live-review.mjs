import fs from "node:fs";

const IDS_FILE = "fresh-collar-review-ids.txt";
const REPORT_FILE = "_site/collar-photo-report.json";
const GALLERY_FILE = "_site/collar-photo-gallery.html";
const SOURCE_URL = process.env.PROM_SOURCE_URL;
const EXPECTED = 325;

if (!SOURCE_URL) throw new Error("PROM_SOURCE_URL secret is missing");
for (const path of [IDS_FILE, REPORT_FILE, GALLERY_FILE]) {
  if (!fs.existsSync(path)) throw new Error(`Fresh Collar live review: required file missing: ${path}`);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/^<!\[CDATA\[/i, "")
    .replace(/\]\]>$/i, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .trim();
}

function tagValue(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? decodeXml(m[1]) : "";
}

function offerId(xml) {
  const m = xml.match(/\bid=(["'])([^"']+)\1/i);
  return m ? String(m[2]).trim() : "";
}

function pictures(xml) {
  const out = [];
  const re = /<picture\b[^>]*>([\s\S]*?)<\/picture>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const url = decodeXml(m[1]);
    if (url) out.push({ position: out.length + 1, url });
  }
  return out;
}

function cardHtml(item) {
  const images = item.pictures.map(p => `
  <div class="photo">
    <div class="position">Фото №${p.position}</div>
    <img src="${esc(p.url)}" loading="lazy" onclick="selectMainPhoto('${esc(item.rozetka_offer_id)}', ${p.position}, this)">
    <button class="main-photo-button" onclick="selectMainPhoto('${esc(item.rozetka_offer_id)}', ${p.position}, this)">⭐ Зробити головним</button>
    <button class="end-photo-button" onclick="selectEndPhoto('${esc(item.rozetka_offer_id)}', ${p.position}, this)">📐 В кінець</button>
  </div>`).join("");

  return `
<section class="card fresh-pricecreator-review" data-id="${esc(item.rozetka_offer_id)}">
  <div class="info">
    <h2>${esc(item.name)}</h2>
    <div><b>Rozetka ID:</b> ${esc(item.rozetka_offer_id)}</div>
    <div><b>Prom ID:</b> ${esc(item.source_id)}</div>
    <div><b>Виробник:</b> ${esc(item.vendor || "")}</div>
    <div><b>Кількість фото:</b> ${item.pictures_count}</div>
    <div class="status fresh-pricecreator-status">🆕 Залишок Collar для ручної перевірки</div>
  </div>
  <div class="review-buttons">
    <button onclick="markReview('${esc(item.rozetka_offer_id)}', 'ok', this)">✅ Фото №1 нормальне</button>
    <button onclick="markReview('${esc(item.rozetka_offer_id)}', 'problem', this)">⚠️ Треба виправити головне фото</button>
  </div>
  <div class="photos">${images}</div>
</section>`;
}

const ids = [...new Set(fs.readFileSync(IDS_FILE, "utf8").split(/\r?\n/).map(x => x.trim()).filter(Boolean))];
if (ids.length !== EXPECTED) throw new Error(`Fresh Collar live review: expected ${EXPECTED} IDs, found ${ids.length}`);
const wanted = new Set(ids);

const response = await fetch(SOURCE_URL, {
  headers: {
    "User-Agent": "D&D-Home-Pets-Collar-Review/1.0",
    "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8"
  }
});
if (!response.ok) throw new Error(`Fresh Collar live review: source HTTP ${response.status}`);
const xml = await response.text();

const sourceById = new Map();
const offerRe = /<offer\b[\s\S]*?<\/offer>/gi;
let match;
while ((match = offerRe.exec(xml)) !== null) {
  const id = offerId(match[0]);
  if (wanted.has(id)) sourceById.set(id, match[0]);
}

const report = JSON.parse(fs.readFileSync(REPORT_FILE, "utf8"));
const reportById = new Map(report.map(item => [String(item.rozetka_offer_id || item.source_id || "").trim(), item]));
const added = [];
const missingSource = [];
const tooFewPhotos = [];

for (const id of ids) {
  if (reportById.has(id)) continue;
  const sourceOffer = sourceById.get(id);
  if (!sourceOffer) {
    missingSource.push(id);
    continue;
  }
  const pics = pictures(sourceOffer);
  if (pics.length < 2) {
    tooFewPhotos.push(id);
    continue;
  }
  const item = {
    source_id: id,
    rozetka_offer_id: id,
    article: tagValue(sourceOffer, "vendorCode"),
    name: tagValue(sourceOffer, "name_ua") || tagValue(sourceOffer, "name") || id,
    vendor: tagValue(sourceOffer, "vendor") || null,
    photo_fix_target: false,
    rozetka_review_target: false,
    fresh_pricecreator_review: true,
    manual_choice: false,
    pictures_count: pics.length,
    pictures: pics,
    pricecreator_status: "",
    pricecreator_availability: "",
    pricecreator_category: ""
  };
  report.push(item);
  reportById.set(id, item);
  added.push(item);
}

fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");

let html = fs.readFileSync(GALLERY_FILE, "utf8");
if (added.length) {
  const firstScript = html.indexOf("<script>");
  if (firstScript < 0) throw new Error("Fresh Collar live review: gallery <script> marker not found");
  html = html.slice(0, firstScript) + added.map(cardHtml).join("\n") + "\n" + html.slice(firstScript);
}

const filterMarker = '<button onclick="showRozetkaReview()">Тільки з файлу Rozetka</button>';
if (!html.includes('showFreshPricecreatorReview()')) {
  if (!html.includes(filterMarker)) throw new Error("Fresh Collar live review: filter marker not found");
  html = html.replace(filterMarker, filterMarker + '\n  <button onclick="showFreshPricecreatorReview()">🆕 Тільки 325 Collar</button>');
}

if (!html.includes('const freshPricecreatorReviewIds = new Set(')) {
  const idsPayload = JSON.stringify(ids).replace(/</g, "\\u003c");
  const functionMarker = '  function showRozetkaReview() {';
  if (!html.includes(functionMarker)) throw new Error("Fresh Collar live review: showRozetkaReview marker not found");
  html = html.replace(
    functionMarker,
    `  const freshPricecreatorReviewIds = new Set(${idsPayload});\n\n  function showFreshPricecreatorReview() {\n    document.querySelectorAll('.card').forEach(card => {\n      card.style.display = freshPricecreatorReviewIds.has(String(card.dataset.id || '')) ? '' : 'none';\n    });\n  }\n\n${functionMarker}`
  );
}

if (!html.includes('.card.fresh-pricecreator-review')) {
  html = html.replace(
    "</style>",
    `.card.fresh-pricecreator-review {\n    border-color: #7b5cc7;\n  }\n  .fresh-pricecreator-status {\n    color: #6644aa;\n    font-weight: bold;\n  }\n</style>`
  );
}

fs.writeFileSync(GALLERY_FILE, html, "utf8");

const visible = ids.filter(id => reportById.has(id)).length;
console.log(`Fresh Collar live review: requested=${ids.length}; visible in report=${visible}; newly added=${added.length}; missing source=${missingSource.length}; <2 photos now=${tooFewPhotos.length}; final report=${report.length}`);
if (missingSource.length) console.log(`Missing source IDs: ${missingSource.join(",")}`);
if (tooFewPhotos.length) console.log(`<2 photo IDs: ${tooFewPhotos.join(",")}`);

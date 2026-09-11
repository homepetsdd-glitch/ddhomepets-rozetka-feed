import fs from "node:fs";
import { gunzipSync } from "node:zlib";

const SNAPSHOT_FILE = "fresh-collar-review.json.gz.b64";
const REPORT_FILE = "_site/collar-photo-report.json";
const GALLERY_FILE = "_site/collar-photo-gallery.html";
const EXPECTED = 325;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeItem(raw) {
  const id = String(raw.rozetka_offer_id || raw.source_id || "").trim();
  const pics = Array.isArray(raw.pictures)
    ? raw.pictures
        .map((p, index) => ({
          position: Number(p?.position || index + 1),
          url: String(p?.url || "").trim()
        }))
        .filter(p => p.position > 0 && p.url)
    : [];
  return {
    source_id: String(raw.source_id || id),
    rozetka_offer_id: id,
    article: String(raw.article || ""),
    name: String(raw.name || id),
    vendor: raw.vendor == null ? null : String(raw.vendor),
    photo_fix_target: false,
    rozetka_review_target: false,
    fresh_pricecreator_review: true,
    manual_choice: false,
    pictures_count: pics.length,
    pictures: pics,
    pricecreator_status: String(raw.status || ""),
    pricecreator_availability: String(raw.availability || ""),
    pricecreator_category: String(raw.category || "")
  };
}

function cardHtml(item) {
  const images = item.pictures.map(p => `
  <div class="photo">
    <div class="position">Фото №${p.position}</div>
    <img
      src="${esc(p.url)}"
      loading="lazy"
      onclick="selectMainPhoto('${esc(item.rozetka_offer_id)}', ${p.position}, this)"
    >
    <button
      class="main-photo-button"
      onclick="selectMainPhoto('${esc(item.rozetka_offer_id)}', ${p.position}, this)"
    >
      ⭐ Зробити головним
    </button>
    <button
      class="end-photo-button"
      onclick="selectEndPhoto('${esc(item.rozetka_offer_id)}', ${p.position}, this)"
    >
      📐 В кінець
    </button>
  </div>`).join("");

  return `
<section class="card fresh-pricecreator-review" data-id="${esc(item.rozetka_offer_id)}">
  <div class="info">
    <h2>${esc(item.name)}</h2>
    <div><b>Rozetka ID:</b> ${esc(item.rozetka_offer_id)}</div>
    <div><b>Prom ID:</b> ${esc(item.source_id)}</div>
    <div><b>Виробник:</b> ${esc(item.vendor || "")}</div>
    <div><b>Кількість фото:</b> ${item.pictures_count}</div>
    <div><b>Pricecreator:</b> ${esc(item.pricecreator_status)} · ${esc(item.pricecreator_availability)}</div>
    <div><b>Категорія:</b> ${esc(item.pricecreator_category)}</div>
    <div class="status fresh-pricecreator-status">🆕 Перевірка з нової вигрузки Pricecreator</div>
  </div>
  <div class="review-buttons">
    <button onclick="markReview('${esc(item.rozetka_offer_id)}', 'ok', this)">✅ Фото №1 нормальне</button>
    <button onclick="markReview('${esc(item.rozetka_offer_id)}', 'problem', this)">⚠️ Треба виправити головне фото</button>
  </div>
  <div class="photos">${images}</div>
</section>`;
}

if (!fs.existsSync(SNAPSHOT_FILE) || !fs.existsSync(REPORT_FILE) || !fs.existsSync(GALLERY_FILE)) {
  throw new Error("Fresh Pricecreator Collar review: required files are missing");
}

const encoded = fs.readFileSync(SNAPSHOT_FILE, "utf8").trim();
const decoded = gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
const snapshot = JSON.parse(decoded).map(normalizeItem).filter(x => /^\d{10}$/.test(x.rozetka_offer_id));
const unique = [...new Map(snapshot.map(x => [x.rozetka_offer_id, x])).values()];
if (unique.length !== EXPECTED) {
  throw new Error(`Fresh Pricecreator Collar review: expected ${EXPECTED} unique items, found ${unique.length}`);
}
if (unique.some(x => x.pictures_count < 2)) {
  throw new Error("Fresh Pricecreator Collar review: snapshot contains item with <2 photos");
}

const report = JSON.parse(fs.readFileSync(REPORT_FILE, "utf8"));
const reportIds = new Set(report.map(x => String(x.rozetka_offer_id || "")));
const added = [];
for (const item of unique) {
  if (reportIds.has(item.rozetka_offer_id)) continue;
  report.push(item);
  reportIds.add(item.rozetka_offer_id);
  added.push(item);
}
fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");

let html = fs.readFileSync(GALLERY_FILE, "utf8");
if (added.length) {
  const firstScript = html.indexOf("<script>");
  if (firstScript < 0) throw new Error("Fresh Pricecreator Collar review: gallery <script> marker not found");
  html = html.slice(0, firstScript) + added.map(cardHtml).join("\n") + "\n" + html.slice(firstScript);
}

const filterMarker = '<button onclick="showRozetkaReview()">Тільки з файлу Rozetka</button>';
if (!html.includes(filterMarker)) {
  throw new Error("Fresh Pricecreator Collar review: filter marker not found");
}
html = html.replace(
  filterMarker,
  filterMarker + '\n  <button onclick="showFreshPricecreatorReview()">🆕 Тільки 325 з нової вигрузки</button>'
);

const idsPayload = JSON.stringify(unique.map(x => x.rozetka_offer_id)).replace(/</g, "\\u003c");
const functionMarker = '  function showRozetkaReview() {';
if (!html.includes(functionMarker)) {
  throw new Error("Fresh Pricecreator Collar review: showRozetkaReview marker not found");
}
html = html.replace(
  functionMarker,
  `  const freshPricecreatorReviewIds = new Set(${idsPayload});\n\n  function showFreshPricecreatorReview() {\n    document.querySelectorAll('.card').forEach(card => {\n      card.style.display = freshPricecreatorReviewIds.has(String(card.dataset.id || '')) ? '' : 'none';\n    });\n  }\n\n${functionMarker}`
);

html = html.replace(
  "</style>",
  `.card.fresh-pricecreator-review {\n    border-color: #7b5cc7;\n  }\n  .fresh-pricecreator-status {\n    color: #6644aa;\n    font-weight: bold;\n  }\n</style>`
);

fs.writeFileSync(GALLERY_FILE, html, "utf8");
console.log(
  `Fresh Pricecreator Collar review: requested=${unique.length}; already in report=${unique.length - added.length}; added=${added.length}; final report=${report.length}`
);

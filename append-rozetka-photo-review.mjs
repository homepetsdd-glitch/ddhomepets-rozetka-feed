import fs from "node:fs";

const IDS_FILE = "rozetka-photo-review-offerids.txt";
const REPORT_FILE = "_site/collar-photo-report.json";
const GALLERY_FILE = "_site/collar-photo-gallery.html";
const CHOICES_FILE = "collar-photo-choices.json";

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

function pictures(xml) {
  return [...xml.matchAll(/<picture(?:\s[^>]*)?>([\s\S]*?)<\/picture>/gi)]
    .map(m => decodeXml(m[1]).trim())
    .filter(Boolean);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isCollarFamily(offer) {
  const vendor = (tag(offer, "vendor") || "").trim().toLowerCase();
  const name = (tag(offer, "name_ua") || tag(offer, "name") || "").toLowerCase();
  const words = [
    "collar", "waudog", "waucat", "evolutor", "dog extreme", "dog extremе",
    "airyvest", "puller", "liker", "flyber", "pitchdog", "superium", "supercat"
  ];
  return vendor === "collar" || vendor === "collar company" || words.some(word => name.includes(word));
}

function cardHtml(item) {
  const visiblePictures = item.photo_fix_target
    ? item.pictures.filter(p => Number(p.position) !== 1)
    : item.pictures;

  const images = visiblePictures.map(p => `
  <div class="photo">
    <div class="position">Фото №${p.position}</div>
    <img
      src="${esc(p.url)}"
      loading="lazy"
      onclick="selectMainPhoto('${esc(item.rozetka_offer_id)}', ${p.position}, this); markRozetkaReviewProblem('${esc(item.rozetka_offer_id)}', this)"
    >
    <button
      class="main-photo-button"
      onclick="selectMainPhoto('${esc(item.rozetka_offer_id)}', ${p.position}, this); markRozetkaReviewProblem('${esc(item.rozetka_offer_id)}', this)"
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
<section
  class="card rozetka-review ${item.photo_fix_target ? "photo-fix" : ""}"
  data-id="${esc(item.rozetka_offer_id)}"
>
  <div class="info">
    <h2>${esc(item.name)}</h2>
    <div><b>Rozetka ID:</b> ${esc(item.rozetka_offer_id)}</div>
    <div><b>Prom ID:</b> ${esc(item.source_id)}</div>
    <div><b>Артикул:</b> ${esc(item.article)}</div>
    <div><b>Кількість фото:</b> ${item.photo_fix_target ? visiblePictures.length : item.pictures_count}</div>
    <div class="status rozetka-review-status">📋 Є у файлі підтвердження Rozetka — фото №1 «різновиди» прибране</div>
  </div>
  <div class="review-buttons">
    <button onclick="markReview('${esc(item.rozetka_offer_id)}', 'ok', this)">
      ✅ Фото №1 нормальне
    </button>
    <button onclick="markReview('${esc(item.rozetka_offer_id)}', 'problem', this)">
      ⚠️ Треба виправити головне фото
    </button>
  </div>
  <div class="photos">${images}</div>
</section>`;
}

if (!fs.existsSync(IDS_FILE) || !fs.existsSync(REPORT_FILE) || !fs.existsSync(GALLERY_FILE)) {
  throw new Error("Rozetka photo review: required files are missing");
}

const ids = [...new Set(
  fs.readFileSync(IDS_FILE, "utf8")
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => /^\d{10}$/.test(s))
)];

if (ids.length !== 508) {
  throw new Error(`Safety stop: expected 508 Rozetka photo-review OFFERIDs, found ${ids.length}`);
}

const idSet = new Set(ids);
const report = JSON.parse(fs.readFileSync(REPORT_FILE, "utf8"));
const choices = fs.existsSync(CHOICES_FILE)
  ? JSON.parse(fs.readFileSync(CHOICES_FILE, "utf8"))
  : {};

const existingReportIds = new Set(report.map(x => String(x.rozetka_offer_id)));
const wanted = ids.filter(id => !existingReportIds.has(id) && !choices[id]);

const sourceUrl = String(process.env.PROM_SOURCE_URL || "").trim();
if (!sourceUrl) throw new Error("Rozetka photo review: PROM_SOURCE_URL is missing");

const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`Rozetka photo review: source XML HTTP ${response.status}`);
const xml = await response.text();

const byId = new Map();
for (const m of xml.matchAll(/<offer\b[\s\S]*?<\/offer>/gi)) {
  const offer = m[0];
  const id = offerId(offer);
  if (id && idSet.has(id)) byId.set(id, offer);
}

const added = [];
let notFound = 0;
let notCollar = 0;
let singlePhoto = 0;

for (const id of wanted) {
  const offer = byId.get(id);
  if (!offer) {
    notFound++;
    continue;
  }
  if (!isCollarFamily(offer)) {
    notCollar++;
    continue;
  }

  const pics = pictures(offer);
  if (pics.length < 2) {
    singlePhoto++;
    continue;
  }

  const item = {
    source_id: id,
    rozetka_offer_id: id,
    article: tag(offer, "article"),
    name: tag(offer, "name_ua") || tag(offer, "name"),
    vendor: tag(offer, "vendor") || null,
    photo_fix_target: true,
    rozetka_review_target: true,
    manual_choice: false,
    pictures_count: pics.length,
    pictures: pics.map((url, index) => ({ position: index + 1, url }))
  };
  report.push(item);
  added.push(item);
}

fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");

let html = fs.readFileSync(GALLERY_FILE, "utf8");

if (added.length) {
  const firstScript = html.indexOf("<script>");
  if (firstScript < 0) throw new Error("Rozetka photo review: gallery <script> marker not found");
  html = html.slice(0, firstScript) + added.map(cardHtml).join("\n") + "\n" + html.slice(firstScript);
}

html = html.replace(
  '<button onclick="showPhotoFix()">Тільки PHOTO_FIX: TRUE</button>',
  '<button onclick="showPhotoFix()">Тільки PHOTO_FIX: TRUE</button>\n  <button onclick="showRozetkaReview()">Тільки з файлу Rozetka</button>'
);

html = html.replace(
  '  function markReview(id, status, button) {',
  `  function showRozetkaReview() {
    document.querySelectorAll(".card").forEach(card => {
      card.style.display = card.classList.contains("rozetka-review") ? "" : "none";
    });
  }

  function markRozetkaReviewProblem(id, element) {
    const card = element.closest(".card");
    if (!card || !card.classList.contains("rozetka-review")) return;
    if (Number(card.dataset.mainPhoto || 1) === 1) return;
    localStorage.setItem("collar_review_" + id, "problem");
    card.dataset.review = "problem";
  }

  function markReview(id, status, button) {`
);

html = html.replace(
  "</style>",
  `.card.rozetka-review {
    border-color: #2f6fdb;
  }
  .rozetka-review-status {
    color: #1759b8;
  }
</style>`
);

fs.writeFileSync(GALLERY_FILE, html, "utf8");

console.log(
  `Rozetka photo review: requested=${ids.length}; already in report/choices=${ids.length - wanted.length}; added=${added.length}; not found in source=${notFound}; non-Collar=${notCollar}; <2 photos=${singlePhoto}; final report=${report.length}`
);

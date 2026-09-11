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

// ---------------------------------------------------------------------------
// SAFE Collar photo auto-suggestions
// ---------------------------------------------------------------------------
// Important: this runs AFTER feed.xml is already generated. It changes ONLY the
// review report/gallery. The actual feed keeps using manual collar-photo-choices.
// This means an automatic guess can never silently change Rozetka photos.

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function tagValue(offer, tag) {
  const m = offer.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeXml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim()) : "";
}

function offerId(offer) {
  const m = offer.match(/<offer\b[^>]*\bid=["']([^"']+)["']/i);
  return m ? String(m[1]) : "";
}

const VARIABLE_WORDS = new Set([
  "для", "собак", "собаки", "котів", "котов", "кішок", "кошек", "та", "і", "и",
  "розмір", "размер", "колір", "цвет", "ширина", "довжина", "длина", "см", "мм",
  "чорний", "черный", "чорна", "черная", "білий", "белый", "біла", "белая",
  "сірий", "серый", "сіра", "серая", "рожевий", "розовый", "рожева", "розовая",
  "червоний", "красный", "червона", "красная", "синій", "синий", "синя", "синяя",
  "блакитний", "голубой", "зелений", "зеленый", "зелена", "зеленая",
  "жовтий", "желтый", "жовта", "желтая", "помаранчевий", "оранжевый",
  "фіолетовий", "фиолетовый", "коричневий", "коричневый", "бежевий", "бежевый",
  "xs", "s", "m", "l", "xl", "xxl", "xxxl"
]);

function normalizedTokens(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[«»“”„\"'()\[\]{},.:;!?№#+/\\|_-]+/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
    .split(/\s+/)
    .map(x => x.trim())
    .filter(x => x.length > 1 && !VARIABLE_WORDS.has(x));
}

function similarity(a, b) {
  const aa = new Set(a);
  const bb = new Set(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const x of aa) if (bb.has(x)) common++;
  const union = new Set([...aa, ...bb]).size;
  return union ? common / union : 0;
}

function knownBrand(tokens) {
  const brands = ["collar", "waudog", "waucat", "evolutor", "dog", "extreme", "airyvest", "puller", "liker", "flyber", "pitchdog", "superium"];
  return brands.filter(x => tokens.includes(x)).join("|");
}

async function addSafeCollarAutoSuggestions() {
  const reportPath = "_site/collar-photo-report.json";
  const galleryPath = "_site/collar-photo-gallery.html";
  const feedPath = "_site/feed.xml";
  const choicesPath = "collar-photo-choices.json";

  if (!fs.existsSync(reportPath) || !fs.existsSync(galleryPath) || !fs.existsSync(feedPath) || !fs.existsSync(choicesPath)) {
    throw new Error("Safety stop: auto-suggest input files missing");
  }

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const choices = JSON.parse(fs.readFileSync(choicesPath, "utf8"));
  const feedXml = fs.readFileSync(feedPath, "utf8");

  const metadata = new Map();
  const re = /<offer\b[\s\S]*?<\/offer>/gi;
  let m;
  while ((m = re.exec(feedXml)) !== null) {
    const offer = m[0];
    const id = offerId(offer);
    if (!id) continue;
    metadata.set(id, {
      id,
      name: tagValue(offer, "name_ua") || tagValue(offer, "name"),
      vendor: tagValue(offer, "vendor")
    });
  }

  const reviewed = [];
  for (const [id, choice] of Object.entries(choices)) {
    const meta = metadata.get(String(id));
    if (!meta) continue;
    const tokens = normalizedTokens(meta.name);
    if (tokens.length < 2) continue;
    reviewed.push({
      id: String(id),
      name: meta.name,
      vendor: String(meta.vendor || "").toLowerCase(),
      tokens,
      brand: knownBrand(tokens),
      main: Number(choice?.main_photo || 1),
      end: choice?.end_photo == null ? null : Number(choice.end_photo),
      review: String(choice?.review || "")
    });
  }

  const suggestions = {};
  for (const item of report) {
    const tokens = normalizedTokens(item.name);
    const vendor = String(item.vendor || "").toLowerCase();
    const brand = knownBrand(tokens);

    let best = null;
    for (const r of reviewed) {
      // Prefer same vendor/brand family and avoid borrowing a layout from an unrelated line.
      const vendorCompatible = vendor && r.vendor && vendor === r.vendor;
      const brandCompatible = brand && r.brand && brand === r.brand;
      if (!vendorCompatible && !brandCompatible) continue;

      const score = similarity(tokens, r.tokens);
      if (!best || score > best.score) best = { r, score };
    }

    let main = 1;
    let end = null;
    let sourceId = null;
    let confidence = 0;
    let mode = "default-first-photo";

    if (best && best.score >= 0.60) {
      const candidateMain = Number(best.r.main || 1);
      const candidateEnd = best.r.end == null ? null : Number(best.r.end);
      const max = Number(item.pictures_count || 0);

      if (candidateMain >= 1 && candidateMain <= max) {
        main = candidateMain;
        if (candidateEnd >= 1 && candidateEnd <= max && candidateEnd !== main) {
          end = candidateEnd;
        }
        sourceId = best.r.id;
        confidence = Number(best.score.toFixed(2));
        mode = "learned-from-reviewed-similar-product";
      }
    }

    const review = main !== 1 ? "problem" : "ok";
    const suggestion = {
      main_photo: main,
      end_photo: end,
      review,
      mode,
      confidence,
      learned_from_id: sourceId
    };
    item.auto_suggestion = suggestion;
    suggestions[String(item.rozetka_offer_id)] = suggestion;
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  let gallery = fs.readFileSync(galleryPath, "utf8");
  const suggestionsJson = JSON.stringify(suggestions).replace(/</g, "\\u003c");
  const autoScript = `
<style>
.auto-note{padding:12px 14px;margin:0 0 18px;background:#fff7cc;border:1px solid #d7b700;border-radius:8px;font-size:14px}
.auto-badge{display:inline-block;margin-top:7px;padding:3px 7px;background:#eef5ff;border:1px solid #8aaee8;border-radius:5px;font-size:12px}
</style>
<script>
const COLLAR_AUTO_SUGGESTIONS = ${suggestionsJson};
document.addEventListener("DOMContentLoaded", () => {
  const heading = document.querySelector("h1");
  if (heading && !document.querySelector(".auto-note")) {
    const note = document.createElement("div");
    note.className = "auto-note";
    note.innerHTML = "🤖 <b>Автопідбір увімкнено.</b> Порядок запропонований за твоїми вже перевіреними товарами. Якщо картка виглядає правильно — нічого натискати не треба. Виправляй тільки помилки, потім експортуй вибір.";
    heading.insertAdjacentElement("afterend", note);
  }

  document.querySelectorAll(".card").forEach(card => {
    const id = card.dataset.id;
    const s = COLLAR_AUTO_SUGGESTIONS[id];
    if (!s) return;

    const reviewKey = "collar_review_" + id;
    const mainKey = "collar_main_photo_" + id;
    const endKey = "collar_end_photo_" + id;

    // Never overwrite anything the user already clicked manually in this browser.
    if (!localStorage.getItem(reviewKey)) localStorage.setItem(reviewKey, s.review);
    if (!localStorage.getItem(mainKey)) localStorage.setItem(mainKey, String(s.main_photo || 1));
    if (s.end_photo && !localStorage.getItem(endKey)) localStorage.setItem(endKey, String(s.end_photo));

    const review = localStorage.getItem(reviewKey);
    const main = Number(localStorage.getItem(mainKey) || 1);
    const end = Number(localStorage.getItem(endKey) || 0);
    card.dataset.review = review || "ok";
    card.dataset.mainPhoto = String(main);
    if (end) card.dataset.endPhoto = String(end);

    const photos = card.querySelectorAll(".photo");
    photos.forEach(p => { p.classList.remove("selected-main"); p.classList.remove("selected-end"); });
    if (photos[main - 1]) photos[main - 1].classList.add("selected-main");
    if (end && photos[end - 1]) photos[end - 1].classList.add("selected-end");

    const buttons = card.querySelectorAll(".review-buttons button");
    buttons.forEach(b => { b.style.fontWeight = "normal"; b.style.outline = "none"; });
    if (review === "ok" && buttons[0]) { buttons[0].style.fontWeight = "bold"; buttons[0].style.outline = "3px solid #333"; }
    if (review === "problem" && buttons[1]) { buttons[1].style.fontWeight = "bold"; buttons[1].style.outline = "3px solid #333"; }

    const info = card.querySelector(".info");
    if (info && !info.querySelector(".auto-badge")) {
      const badge = document.createElement("div");
      badge.className = "auto-badge";
      badge.textContent = s.mode === "learned-from-reviewed-similar-product"
        ? "🤖 Авто: схожий перевірений товар " + s.learned_from_id + " · " + Math.round(s.confidence * 100) + "%"
        : "🤖 Авто: залишено Фото №1 (немає достатньо схожого перевіреного товару)";
      info.appendChild(badge);
    }
  });
});
</script>
`;

  if (!gallery.includes("</body>")) {
    throw new Error("Safety stop: gallery </body> marker missing");
  }
  gallery = gallery.replace("</body>", autoScript + "\n</body>");
  fs.writeFileSync(galleryPath, gallery, "utf8");

  const learned = Object.values(suggestions).filter(x => x.mode === "learned-from-reviewed-similar-product").length;
  console.log(`Collar photo auto-suggestions: ${Object.keys(suggestions).length} total, ${learned} learned from reviewed products`);
}

fs.writeFileSync(TEMP_FILE, source, "utf8");

try {
  await import(pathToFileURL(`${process.cwd()}/${TEMP_FILE}`).href + `?t=${Date.now()}`);
  await addSafeCollarAutoSuggestions();
} finally {
  try { fs.unlinkSync(TEMP_FILE); } catch {}
}

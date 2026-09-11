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

function seriesKey(name = "") {
  let s = String(name).toLowerCase();
  s = s.split(/,\s*(?:малюнок|рисунок|принт|колір|цвет|розмір|размер)\b/i)[0];
  s = s
    .replace(/[«»“”„"'`’]/g, " ")
    .replace(/[()\[\]{},.:;!?/\\|+_=–—-]/g, " ")
    .replace(/\b(?:xxxs|xxs|xxl|xxxl|xs|xl|s|m|l)\b/gi, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:мм|см|м|кг|г|л|ml|kg|cm|mm)\b/gi, " ")
    .replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
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
  const name = tag(xml, "name_ua") || tag(xml, "name");
  meta.set(id, { id, name, series: seriesKey(name) });
}

// Learn only the user's MANUAL "to end" choices, grouped by product series.
// We do not copy a single product blindly. A position is trusted only when there
// are at least 3 reviewed examples in the same series and >=70% agree.
const seriesStats = new Map();
for (const [id, choice] of Object.entries(choices)) {
  const m = meta.get(String(id));
  if (!m || !m.series || !choice) continue;
  const review = String(choice.review || "").toLowerCase();
  if (review === "auto") continue;

  const end = Number(choice.end_photo || 0);
  if (!end) continue;

  if (!seriesStats.has(m.series)) seriesStats.set(m.series, { total: 0, positions: new Map() });
  const stat = seriesStats.get(m.series);
  stat.total++;
  stat.positions.set(end, (stat.positions.get(end) || 0) + 1);
}

const learnedEndBySeries = new Map();
for (const [series, stat] of seriesStats.entries()) {
  let bestPos = null;
  let bestCount = 0;
  for (const [pos, count] of stat.positions.entries()) {
    if (count > bestCount) {
      bestPos = pos;
      bestCount = count;
    }
  }
  const confidence = stat.total ? bestCount / stat.total : 0;
  if (stat.total >= 3 && confidence >= 0.70) {
    learnedEndBySeries.set(series, {
      position: bestPos,
      examples: stat.total,
      confidence: Math.round(confidence * 100)
    });
  }
}

const suggestions = {};
for (const item of report) {
  if (item.photo_fix_target) continue;

  const count = Number(item.pictures_count || 0);
  const series = seriesKey(item.name || "");
  const learned = learnedEndBySeries.get(series) || null;
  const end = learned && learned.position > 1 && learned.position <= count
    ? learned.position
    : null;

  suggestions[String(item.rozetka_offer_id)] = {
    main_photo: 1,
    end_photo: end,
    mode: end ? "series_consensus" : "safe_default",
    series,
    learned_examples: learned ? learned.examples : 0,
    learned_confidence: learned ? learned.confidence : 0
  };
}

fs.writeFileSync(OUT_FILE, JSON.stringify(suggestions, null, 2) + "\n", "utf8");

let html = fs.readFileSync(GALLERY_FILE, "utf8");
const payload = escJsJson(suggestions);
const inject = `\n<script>\n(() => {\n  const suggestions = ${payload};\n\n  function clearAutoVisuals(card) {\n    card.querySelectorAll('.photo').forEach(photo => {\n      photo.classList.remove('selected-main');\n      photo.classList.remove('selected-end');\n    });\n    delete card.dataset.mainPhoto;\n    delete card.dataset.endPhoto;\n  }\n\n  function applyVisual(card, kind, position) {\n    if (!position) return;\n    const photos = card.querySelectorAll('.photo');\n    const photo = photos[Number(position) - 1];\n    if (!photo) return;\n    photo.classList.add(kind === 'main' ? 'selected-main' : 'selected-end');\n    card.dataset[kind === 'main' ? 'mainPhoto' : 'endPhoto'] = String(position);\n  }\n\n  document.addEventListener('DOMContentLoaded', () => {\n    let applied = 0;\n    let endApplied = 0;\n\n    document.querySelectorAll('.card').forEach(card => {\n      const id = card.dataset.id;\n      const s = suggestions[id];\n      if (!s) return;\n\n      const savedReview = localStorage.getItem('collar_review_' + id);\n      if (savedReview && savedReview !== 'auto') return;\n\n      if (savedReview === 'auto') {\n        localStorage.removeItem('collar_main_photo_' + id);\n        localStorage.removeItem('collar_end_photo_' + id);\n        localStorage.removeItem('collar_review_' + id);\n        clearAutoVisuals(card);\n      }\n\n      localStorage.setItem('collar_main_photo_' + id, '1');\n      localStorage.setItem('collar_review_' + id, 'auto');\n      card.dataset.review = 'auto';\n      applyVisual(card, 'main', 1);\n\n      if (s.end_photo) {\n        localStorage.setItem('collar_end_photo_' + id, String(s.end_photo));\n        applyVisual(card, 'end', s.end_photo);\n        endApplied++;\n      }\n\n      const info = card.querySelector('.info');\n      if (info) {\n        const box = document.createElement('div');\n        box.style.marginTop = '8px';\n        box.style.padding = '7px 9px';\n        box.style.background = '#eaf7ea';\n        box.style.border = '1px solid #76a876';\n        let text = '🤖 Автопідбір: <b>Фото №1 лишається головним</b>.';\n        if (s.end_photo) {\n          text += ' <b>Фото №' + s.end_photo + ' → в кінець</b>.' +\n            '<br><small>Це правило підтверджене ' + s.learned_examples +\n            ' твоїми перевіреними товарами цієї серії (' + s.learned_confidence + '% збігу).</small>';\n        } else {\n          text += '<br><small>Для «в кінець» ще немає достатньо однакових перевірених прикладів — не вгадую.</small>';\n        }\n        box.innerHTML = text;\n        info.appendChild(box);\n      }\n      applied++;\n    });\n\n    const filters = document.querySelector('.filters');\n    if (filters) {\n      const badge = document.createElement('span');\n      badge.style.marginLeft = '10px';\n      badge.style.fontWeight = 'bold';\n      badge.textContent = '🤖 Автопідбір: ' + applied + ' · «в кінець»: ' + endApplied;\n      filters.appendChild(badge);\n    }\n  });\n})();\n<\\/script>\n`;

const bodyIndex = html.lastIndexOf("</body>");
if (bodyIndex < 0) throw new Error("Suggestion builder: </body> not found in gallery");
html = html.slice(0, bodyIndex) + inject + html.slice(bodyIndex);
fs.writeFileSync(GALLERY_FILE, html, "utf8");

console.log(`Collar suggestions: ${Object.keys(suggestions).length}; learned end-photo series: ${learnedEndBySeries.size}`);

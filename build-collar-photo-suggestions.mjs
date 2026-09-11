import fs from "node:fs";

const REPORT_FILE = "_site/collar-photo-report.json";
const CHOICES_FILE = "collar-photo-choices.json";
const REPO_CHOICES_FILE = "collar-photo-choices.repo.json";
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
  let s = String(name).toLowerCase().trim();
  const commaIndex = s.indexOf(",");
  if (commaIndex > 0) s = s.slice(0, commaIndex);
  return s
    .replace(/[«»“”„"'`’]/g, " ")
    .replace(/[()\[\]{},.:;!?/\\|+_=–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escJsJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function addOfferMeta(xmlText, meta) {
  for (const m of String(xmlText || "").matchAll(/<offer\b[\s\S]*?<\/offer>/gi)) {
    const xml = m[0];
    const id = offerId(xml);
    if (!id) continue;
    const name = tag(xml, "name_ua") || tag(xml, "name");
    if (!name) continue;
    meta.set(String(id), { id: String(id), name, series: seriesKey(name) });
  }
}

if (!fs.existsSync(REPORT_FILE) || !fs.existsSync(CHOICES_FILE) || !fs.existsSync(FEED_FILE) || !fs.existsSync(GALLERY_FILE)) {
  throw new Error("Suggestion builder: required generated files are missing");
}

const report = JSON.parse(fs.readFileSync(REPORT_FILE, "utf8"));
const runtimeChoices = JSON.parse(fs.readFileSync(CHOICES_FILE, "utf8"));
const repoChoices = fs.existsSync(REPO_CHOICES_FILE)
  ? JSON.parse(fs.readFileSync(REPO_CHOICES_FILE, "utf8"))
  : {};
const choices = { ...runtimeChoices, ...repoChoices };
const feed = fs.readFileSync(FEED_FILE, "utf8");

const meta = new Map();
const sourceUrl = String(process.env.PROM_SOURCE_URL || "").trim();
if (sourceUrl) {
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    addOfferMeta(await response.text(), meta);
  } catch (err) {
    console.warn(`Suggestion builder: could not read Prom source XML: ${err.message}`);
  }
}
addOfferMeta(feed, meta);

const seriesStats = new Map();
let resolvedManualChoices = 0;
for (const [id, choice] of Object.entries(choices)) {
  const m = meta.get(String(id));
  if (!m || !m.series || !choice) continue;
  resolvedManualChoices++;
  if (String(choice.review || "").toLowerCase() === "auto") continue;

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
let directChoiceCount = 0;
for (const item of report) {
  if (item.photo_fix_target) continue;

  const count = Number(item.pictures_count || 0);
  const sourceId = String(item.source_id || "");
  const targetId = String(item.rozetka_offer_id || "");
  const direct = repoChoices[sourceId] || repoChoices[targetId] || null;

  if (direct) {
    const directMain = Number(direct.main_photo || 1);
    const directEnd = Number(direct.end_photo || 0);
    suggestions[targetId] = {
      main_photo: directMain >= 1 && directMain <= count ? directMain : 1,
      end_photo: directEnd >= 1 && directEnd <= count ? directEnd : null,
      mode: "saved_manual_choice",
      series: seriesKey(item.name || ""),
      learned_examples: 1,
      learned_confidence: 100
    };
    directChoiceCount++;
    continue;
  }

  const series = seriesKey(item.name || "");
  const learned = learnedEndBySeries.get(series) || null;
  const end = learned && learned.position > 1 && learned.position <= count
    ? learned.position
    : null;

  suggestions[targetId] = {
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
const inject = `
<script>
(() => {
  const suggestions = ${payload};

  function clearAutoVisuals(card) {
    card.querySelectorAll('.photo').forEach(photo => {
      photo.classList.remove('selected-main');
      photo.classList.remove('selected-end');
    });
    delete card.dataset.mainPhoto;
    delete card.dataset.endPhoto;
  }

  function applyVisual(card, kind, position) {
    if (!position) return;
    const photos = card.querySelectorAll('.photo');
    const photo = photos[Number(position) - 1];
    if (!photo) return;
    photo.classList.add(kind === 'main' ? 'selected-main' : 'selected-end');
    card.dataset[kind === 'main' ? 'mainPhoto' : 'endPhoto'] = String(position);
  }

  document.addEventListener('DOMContentLoaded', () => {
    let applied = 0;
    let endApplied = 0;

    document.querySelectorAll('.card').forEach(card => {
      const id = card.dataset.id;
      const s = suggestions[id];
      if (!s) return;

      const savedReview = localStorage.getItem('collar_review_' + id);
      if (savedReview && savedReview !== 'auto') return;

      if (savedReview === 'auto') {
        localStorage.removeItem('collar_main_photo_' + id);
        localStorage.removeItem('collar_end_photo_' + id);
        localStorage.removeItem('collar_review_' + id);
        clearAutoVisuals(card);
      }

      localStorage.setItem('collar_main_photo_' + id, String(s.main_photo || 1));
      localStorage.setItem('collar_review_' + id, 'auto');
      card.dataset.review = 'auto';
      applyVisual(card, 'main', s.main_photo || 1);

      if (s.end_photo) {
        localStorage.setItem('collar_end_photo_' + id, String(s.end_photo));
        applyVisual(card, 'end', s.end_photo);
        endApplied++;
      }

      const info = card.querySelector('.info');
      if (info) {
        const box = document.createElement('div');
        box.style.marginTop = '8px';
        box.style.padding = '7px 9px';
        box.style.background = '#eaf7ea';
        box.style.border = '1px solid #76a876';
        let text = '🤖 Автопідбір: <b>Фото №' + (s.main_photo || 1) + ' головне</b>.';
        if (s.end_photo) {
          text += ' <b>Фото №' + s.end_photo + ' → в кінець</b>.';
          if (s.mode === 'saved_manual_choice') {
            text += '<br><small>Взято прямо з твого вже збереженого ручного вибору для цього товару.</small>';
          } else {
            text += '<br><small>Правило підтверджене ' + s.learned_examples +
              ' твоїми перевіреними товарами цієї серії (' + s.learned_confidence + '% збігу).</small>';
          }
        } else {
          text += '<br><small>Для «в кінець» ще немає достатньо однакових перевірених прикладів — не вгадую.</small>';
        }
        box.innerHTML = text;
        info.appendChild(box);
      }
      applied++;
    });

    const filters = document.querySelector('.filters');
    if (filters) {
      const badge = document.createElement('span');
      badge.style.marginLeft = '10px';
      badge.style.fontWeight = 'bold';
      badge.textContent = '🤖 Автопідбір: ' + applied + ' · «в кінець»: ' + endApplied;
      filters.appendChild(badge);
    }
  });
})();
</script>
`;

const bodyIndex = html.lastIndexOf("</body>");
if (bodyIndex < 0) throw new Error("Suggestion builder: </body> not found in gallery");
html = html.slice(0, bodyIndex) + inject + html.slice(bodyIndex);
fs.writeFileSync(GALLERY_FILE, html, "utf8");

console.log(`Collar suggestions: ${Object.keys(suggestions).length}; learned end-photo series: ${learnedEndBySeries.size}; manual choices resolved: ${resolvedManualChoices}/${Object.keys(choices).length}; direct saved choices used in report: ${directChoiceCount}`);

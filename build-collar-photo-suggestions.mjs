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

function bestConsensus(positionMap, total, minExamples = 3, minConfidence = 0.70) {
  let bestPos = null;
  let bestCount = 0;
  for (const [pos, count] of positionMap.entries()) {
    if (count > bestCount) {
      bestPos = pos;
      bestCount = count;
    }
  }
  const confidence = total ? bestCount / total : 0;
  if (total < minExamples || confidence < minConfidence) return null;
  return {
    position: bestPos,
    examples: total,
    confidence: Math.round(confidence * 100)
  };
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

  if (!seriesStats.has(m.series)) {
    seriesStats.set(m.series, {
      mainTotal: 0,
      mainPositions: new Map(),
      endTotal: 0,
      endPositions: new Map()
    });
  }
  const stat = seriesStats.get(m.series);

  const main = Number(choice.main_photo || 0);
  if (main > 1) {
    stat.mainTotal++;
    stat.mainPositions.set(main, (stat.mainPositions.get(main) || 0) + 1);
  }

  const end = Number(choice.end_photo || 0);
  if (end > 0) {
    stat.endTotal++;
    stat.endPositions.set(end, (stat.endPositions.get(end) || 0) + 1);
  }
}

const learnedBySeries = new Map();
for (const [series, stat] of seriesStats.entries()) {
  learnedBySeries.set(series, {
    main: bestConsensus(stat.mainPositions, stat.mainTotal),
    end: bestConsensus(stat.endPositions, stat.endTotal)
  });
}

const suggestions = {};
let directChoiceCount = 0;
let photoFixMainLearnedCount = 0;
for (const item of report) {
  const count = Number(item.pictures_count || 0);
  const sourceId = String(item.source_id || "");
  const targetId = String(item.rozetka_offer_id || "");
  const direct = choices[sourceId] || choices[targetId] || null;
  const series = seriesKey(item.name || "");
  const learned = learnedBySeries.get(series) || { main: null, end: null };
  const firstAlreadyRemovedInGallery = Boolean(item.rozetka_review_target);

  if (direct) {
    const directMain = Number(direct.main_photo || 0);
    const directEnd = Number(direct.end_photo || 0);
    suggestions[targetId] = {
      main_photo: directMain >= 1 && directMain <= count ? directMain : null,
      end_photo: directEnd >= 1 && directEnd <= count ? directEnd : null,
      mode: "saved_manual_choice",
      photo_fix_target: Boolean(item.photo_fix_target),
      remove_first_photo: Boolean(item.photo_fix_target) && !firstAlreadyRemovedInGallery,
      first_already_removed_in_gallery: firstAlreadyRemovedInGallery,
      series,
      learned_main_examples: 1,
      learned_main_confidence: 100,
      learned_end_examples: 1,
      learned_end_confidence: 100
    };
    directChoiceCount++;
    continue;
  }

  let main = 1;
  let mode = "safe_default";

  if (item.photo_fix_target) {
    main = learned.main && learned.main.position > 1 && learned.main.position <= count
      ? learned.main.position
      : null;
    mode = main ? "photo_fix_series_consensus" : "photo_fix_needs_review";
    if (main) photoFixMainLearnedCount++;
  }

  const end = learned.end && learned.end.position >= 1 && learned.end.position <= count
    ? learned.end.position
    : null;

  suggestions[targetId] = {
    main_photo: main,
    end_photo: end,
    mode,
    photo_fix_target: Boolean(item.photo_fix_target),
    remove_first_photo: Boolean(item.photo_fix_target) && !firstAlreadyRemovedInGallery,
    first_already_removed_in_gallery: firstAlreadyRemovedInGallery,
    series,
    learned_main_examples: learned.main ? learned.main.examples : 0,
    learned_main_confidence: learned.main ? learned.main.confidence : 0,
    learned_end_examples: learned.end ? learned.end.examples : 0,
    learned_end_confidence: learned.end ? learned.end.confidence : 0
  };
}

fs.writeFileSync(OUT_FILE, JSON.stringify(suggestions, null, 2) + "\n", "utf8");

let html = fs.readFileSync(GALLERY_FILE, "utf8");
const payload = escJsJson(suggestions);
const inject = `
<script>
(() => {
  const suggestions = ${payload};
  const fullAuditResetKey = 'collar_full_audit_2026_09_11_v1';

  function clearAutoVisuals(card) {
    card.querySelectorAll('.photo').forEach(photo => {
      photo.classList.remove('selected-main');
      photo.classList.remove('selected-end');
      photo.classList.remove('auto-removed-first');
      photo.style.display = '';
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

  function hideRemovedFirstPhoto(card) {
    const photos = card.querySelectorAll('.photo');
    const first = photos[0];
    if (!first) return false;
    first.classList.remove('selected-main');
    first.classList.remove('selected-end');
    first.classList.add('auto-removed-first');
    first.style.display = 'none';
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    // One-time reset for this full re-audit. Old local browser marks came from the
    // previous partial gallery and must not suppress freshly generated suggestions.
    if (!localStorage.getItem(fullAuditResetKey)) {
      Object.keys(localStorage).forEach(key => {
        if (
          key.startsWith('collar_review_') ||
          key.startsWith('collar_main_photo_') ||
          key.startsWith('collar_end_photo_')
        ) {
          localStorage.removeItem(key);
        }
      });
      localStorage.setItem(fullAuditResetKey, '1');
    }

    let applied = 0;
    let endApplied = 0;
    let photoFixApplied = 0;
    let firstRemoved = 0;

    document.querySelectorAll('.card').forEach(card => {
      const id = card.dataset.id;
      const s = suggestions[id];
      if (!s) return;

      // Always preserve the visual removal of a known variants/assortment first photo,
      // even when this card has already been manually reviewed after the reset.
      if (s.remove_first_photo && hideRemovedFirstPhoto(card)) {
        firstRemoved++;
      }

      const savedReview = localStorage.getItem('collar_review_' + id);
      if (savedReview && savedReview !== 'auto') return;

      if (savedReview === 'auto') {
        localStorage.removeItem('collar_main_photo_' + id);
        localStorage.removeItem('collar_end_photo_' + id);
        localStorage.removeItem('collar_review_' + id);
        clearAutoVisuals(card);
        if (s.remove_first_photo) hideRemovedFirstPhoto(card);
      }

      localStorage.setItem('collar_review_' + id, 'auto');
      card.dataset.review = 'auto';

      if (s.main_photo) {
        localStorage.setItem('collar_main_photo_' + id, String(s.main_photo));
        applyVisual(card, 'main', s.main_photo);
        if (s.photo_fix_target) photoFixApplied++;
      }

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
        box.style.background = s.photo_fix_target ? '#fff6d8' : '#eaf7ea';
        box.style.border = '1px solid ' + (s.photo_fix_target ? '#d7a928' : '#76a876');

        let text = '🤖 Автопідбір: ';
        if (s.mode === 'saved_manual_choice') {
          if (s.remove_first_photo || s.first_already_removed_in_gallery) text += '<b>Фото №1 (різновиди) видалено.</b> ';
          text += s.main_photo ? '<b>Фото №' + s.main_photo + ' головне</b>.' : '<b>головне не задане</b>.';
          if (s.end_photo) text += ' <b>Фото №' + s.end_photo + ' → в кінець</b>.';
          text += '<br><small>Це твій попередній збережений вибір. У повному аудиті його треба ще раз перевірити, бо фото постачальника могли змінитися.</small>';
        } else if (s.photo_fix_target) {
          text += '<b>Фото №1 = різновиди — видалено.</b> ';
          if (s.main_photo) {
            text += '<b>Фото №' + s.main_photo + ' → головне.</b>' +
              '<br><small>Так робиться у ' + s.learned_main_examples +
              ' твоїх перевірених товарах цієї серії (' + s.learned_main_confidence + '% збігу).</small>';
          } else {
            text += '<b>Нове головне ще не визначене.</b>' +
              '<br><small>Для вибору нового головного ще немає достатнього однакового правила — перевір очима.</small>';
          }
          if (s.end_photo) {
            text += '<br><b>Фото №' + s.end_photo + ' → в кінець</b> (' +
              s.learned_end_examples + ' прикладів, ' + s.learned_end_confidence + '% збігу).';
          }
        } else {
          text += '<b>Фото №1 головне</b>.';
          if (s.end_photo) {
            text += ' <b>Фото №' + s.end_photo + ' → в кінець</b>.' +
              '<br><small>Правило підтверджене ' + s.learned_end_examples +
              ' твоїми перевіреними товарами цієї серії (' + s.learned_end_confidence + '% збігу).</small>';
          }
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
      badge.textContent = '🔄 Повний аудит COLLAR · автопідбір: ' + applied + ' · PHOTO_FIX головне: ' + photoFixApplied + ' · видалено різновиди: ' + firstRemoved + ' · «в кінець»: ' + endApplied;
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

console.log(`Collar suggestions: ${Object.keys(suggestions).length}; manual choices resolved: ${resolvedManualChoices}/${Object.keys(choices).length}; direct saved choices: ${directChoiceCount}; PHOTO_FIX learned mains: ${photoFixMainLearnedCount}`);

import fs from "node:fs";

const REPORT_FILE = "_site/collar-photo-report.json";
const GALLERY_FILE = "_site/collar-photo-gallery.html";
const OUT_FILE = "_site/collar-photo-suggestions.json";

function escJsJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

if (!fs.existsSync(REPORT_FILE) || !fs.existsSync(GALLERY_FILE)) {
  throw new Error("Suggestion builder: required generated files are missing");
}

const report = JSON.parse(fs.readFileSync(REPORT_FILE, "utf8"));
const suggestions = {};

for (const item of report) {
  // Safe rule learned from the manual review workflow:
  // - For the newly surfaced COLLAR-family items (PHOTO_FIX: FALSE), keep photo #1 as main.
  // - Do NOT guess which photo should go to the end, because that position varies even
  //   between very similar models/prints.
  // - Legacy PHOTO_FIX: TRUE items stay manual, because those are exactly the cases where
  //   the original first photo is known to be suspect.
  if (item.photo_fix_target) continue;

  suggestions[String(item.rozetka_offer_id)] = {
    main_photo: 1,
    end_photo: null,
    mode: "safe_default",
    note: "PHOTO_FIX FALSE: keep original first photo as main; end photo requires visual check"
  };
}

fs.writeFileSync(OUT_FILE, JSON.stringify(suggestions, null, 2) + "\n", "utf8");

let html = fs.readFileSync(GALLERY_FILE, "utf8");
const payload = escJsJson(suggestions);
const inject = `\n<script>\n(() => {\n  const suggestions = ${payload};\n\n  function clearAutoVisuals(card) {\n    card.querySelectorAll('.photo').forEach(photo => {\n      photo.classList.remove('selected-main');\n      photo.classList.remove('selected-end');\n    });\n    delete card.dataset.mainPhoto;\n    delete card.dataset.endPhoto;\n  }\n\n  function applyMain(card, position) {\n    const photos = card.querySelectorAll('.photo');\n    const photo = photos[Number(position) - 1];\n    if (!photo) return;\n    photo.classList.add('selected-main');\n    card.dataset.mainPhoto = String(position);\n  }\n\n  document.addEventListener('DOMContentLoaded', () => {\n    let applied = 0;\n\n    document.querySelectorAll('.card').forEach(card => {\n      const id = card.dataset.id;\n      const s = suggestions[id];\n      if (!s) return;\n\n      const savedReview = localStorage.getItem('collar_review_' + id);\n\n      // Preserve anything the user explicitly reviewed. Only replace our previous auto choices.\n      if (savedReview && savedReview !== 'auto') return;\n\n      if (savedReview === 'auto') {\n        localStorage.removeItem('collar_main_photo_' + id);\n        localStorage.removeItem('collar_end_photo_' + id);\n        localStorage.removeItem('collar_review_' + id);\n        clearAutoVisuals(card);\n      }\n\n      localStorage.setItem('collar_main_photo_' + id, '1');\n      localStorage.setItem('collar_review_' + id, 'auto');\n      card.dataset.review = 'auto';\n      applyMain(card, 1);\n\n      const info = card.querySelector('.info');\n      if (info) {\n        const box = document.createElement('div');\n        box.style.marginTop = '8px';\n        box.style.padding = '7px 9px';\n        box.style.background = '#eaf7ea';\n        box.style.border = '1px solid #76a876';\n        box.innerHTML = '🤖 Безпечний автопідбір: <b>Фото №1 лишається головним</b>.<br>' +\n          '<small>Фото «в кінець» автоматично не вгадуємо — його краще швидко перевірити очима.</small>';\n        info.appendChild(box);\n      }\n\n      applied++;\n    });\n\n    const filters = document.querySelector('.filters');\n    if (filters) {\n      const badge = document.createElement('span');\n      badge.style.marginLeft = '10px';\n      badge.style.fontWeight = 'bold';\n      badge.textContent = '🤖 Безпечний автопідбір: ' + applied;\n      filters.appendChild(badge);\n    }\n  });\n})();\n<\\/script>\n`;

html = html.replace(/<\\/body>\\s*<\\/html>\\s*$/i, inject + "</body>\n</html>");
fs.writeFileSync(GALLERY_FILE, html, "utf8");

console.log(`Collar safe photo suggestions: ${Object.keys(suggestions).length}`);

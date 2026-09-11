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
  // Conservative rule:
  // PHOTO_FIX: FALSE means the original first photo is not known to be bad,
  // so keep photo #1 as main and do not guess an end photo.
  // PHOTO_FIX: TRUE remains manual review only.
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

  function applyMain(card, position) {
    const photos = card.querySelectorAll('.photo');
    const photo = photos[Number(position) - 1];
    if (!photo) return;
    photo.classList.add('selected-main');
    card.dataset.mainPhoto = String(position);
  }

  document.addEventListener('DOMContentLoaded', () => {
    let applied = 0;

    document.querySelectorAll('.card').forEach(card => {
      const id = card.dataset.id;
      const s = suggestions[id];
      if (!s) return;

      const savedReview = localStorage.getItem('collar_review_' + id);

      // Preserve explicit manual review; only replace previous automatic choices.
      if (savedReview && savedReview !== 'auto') return;

      if (savedReview === 'auto') {
        localStorage.removeItem('collar_main_photo_' + id);
        localStorage.removeItem('collar_end_photo_' + id);
        localStorage.removeItem('collar_review_' + id);
        clearAutoVisuals(card);
      }

      localStorage.setItem('collar_main_photo_' + id, '1');
      localStorage.setItem('collar_review_' + id, 'auto');
      card.dataset.review = 'auto';
      applyMain(card, 1);

      const info = card.querySelector('.info');
      if (info) {
        const box = document.createElement('div');
        box.style.marginTop = '8px';
        box.style.padding = '7px 9px';
        box.style.background = '#eaf7ea';
        box.style.border = '1px solid #76a876';
        box.innerHTML = '🤖 Безпечний автопідбір: <b>Фото №1 лишається головним</b>.<br>' +
          '<small>Фото «в кінець» автоматично не вгадуємо — його краще швидко перевірити очима.</small>';
        info.appendChild(box);
      }

      applied++;
    });

    const filters = document.querySelector('.filters');
    if (filters) {
      const badge = document.createElement('span');
      badge.style.marginLeft = '10px';
      badge.style.fontWeight = 'bold';
      badge.textContent = '🤖 Безпечний автопідбір: ' + applied;
      filters.appendChild(badge);
    }
  });
})();
</script>
`;

html = html.replace(/<\/body>\s*<\/html>\s*$/i, inject + "</body>\n</html>");
fs.writeFileSync(GALLERY_FILE, html, "utf8");

console.log(`Collar safe photo suggestions: ${Object.keys(suggestions).length}`);

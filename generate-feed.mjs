// Worker V13: зберігає всю логіку V10 та канонізує URL фото Prom, щоб Rozetka не додавала ті самі фото повторно.
const SOURCE_URL = process.env.PROM_SOURCE_URL;
if (!SOURCE_URL) throw new Error("PROM_SOURCE_URL secret is missing");

// Білий список рівно 3796 OFFERID з актуальної вигрузки Pricecreator від 27.08.2026.
// Список стиснений gzip+base64, щоб код Worker не був на десятки тисяч рядків.
const WHITELIST_GZIP_BASE64 = "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";
// V13: відповідність НОВОГО Prom ID -> СТАРОГО OFFERID у Pricecreator/Rozetka.
// Це дозволяє брати актуальні дані з пересозданих карток Prom,
// але оновлювати вже існуючі картки Rozetka замість створення дублів.
const OFFER_ID_REMAP = Object.freeze({
  "3161289396": "3139691328",
  "3162323140": "3139690393",
  "3162323141": "3139690843",
  "3162323426": "3143850457",
  "3162323437": "3143850462",
  "3162333677": "3143850607",
  "3162333836": "3143850659",
  "3162334756": "3141067543",
  "3162343221": "3143851661",
  "3162343542": "3141067558",
  "3162343610": "3143852043",
  "3163415671": "3139689772",
  "3163415672": "3139689773",
  "3163415676": "3139689919",
  "3163415679": "3139690243",
  "3163415686": "3143850421",
  "3163415687": "3139690428",
  "3163415691": "3139690723",
  "3163415696": "3139690932",
  "3163415698": "3139691330",
  "3163415735": "3141046608",
  "3163415737": "3141009782",
  "3163416058": "3140950080",
  "3163416059": "3141046607",
  "3163416062": "3141067504",
  "3163416064": "3143850565",
  "3163416065": "3141067580",
  "3163416068": "3141067573",
  "3163416069": "3141046708",
  "3163416070": "3143850625",
  "3163416071": "3143850626",
  "3163416385": "3143851001",
  "3163416388": "3141046576",
  "3163416389": "3140976007",
  "3163426725": "3141067503",
  "3163426731": "3140976020",
  "3163426734": "3141067610",
  "3163426737": "3143851212",
  "3163426739": "3141067631",
  "3163426741": "3140976012",
  "3163426826": "3143851536",
  "3163426831": "3141009690",
  "3163426832": "3143851587",
  "3163426836": "3143851652",
  "3163426837": "3140950063",
  "3163426838": "3141614395",
  "3163426911": "3141067428",
  "3163426912": "3143851713",
  "3163426913": "3143851714",
  "3163426917": "3141009783",
  "3163427207": "3141067628",
  "3163427210": "3141009693",
  "3163427240": "3140950081",
  "3163427241": "3140976075",
  "3163427285": "3140950109",
  "3163427290": "3140950185",
  "3163427339": "3141614385",
  "3163427364": "3141597239",
  "3163427397": "3139689836",
  "3163427402": "3139689890",
  "3163427403": "3139689910",
  "3163427404": "3139689927",
  "3163427412": "3139690315",
  "3163427413": "3139690323",
  "3163433438": "3139690336",
  "3163433446": "3139690760",
  "3163433447": "3139690781",
  "3163433452": "3139690860",
  "3163433459": "3139691299",
  "3163433462": "3139691333",
  "3163433467": "3139691382",
  "3163433468": "3139691399",
  "3163433469": "3139691435",
  "3163433479": "3140949988",
  "3163433481": "3140950014",
  "3163433482": "3140950020",
  "3163433483": "3140950024",
  "3163433487": "3140950040",
  "3163433489": "3140950052",
  "3163433492": "3140950061",
  "3163433495": "3140950078",
  "3163433507": "3140950139",
  "3164353861": "3143850413",
  "3164353901": "3143850436",
  "3164354011": "3140976019",
  "3164354012": "3143850566",
  "3164354014": "3141067612",
  "3164354015": "3143850637",
  "3164354088": "3143851107",
  "3164354091": "3140976074",
  "3164354093": "3143851597",
  "3164368540": "3143851676",
  "3164368547": "3140976013",
  "3164368780": "3140975930",
  "3164368781": "3140976080",
  "3164368782": "3140976018",
  "3164368783": "3140976021",
  "3165828733": "3140950163",
  "3165828737": "3140975902",
  "3165828738": "3140975914",
  "3165828739": "3140975965",
  "3165828744": "3140976044",
  "3165828748": "3140976090",
  "3165828751": "3141009639",
  "3165828764": "3141046584",
  "3165828765": "3139689831",
  "3165828766": "3141046585",
  "3165828768": "3141046589",
  "3165828787": "3141067557",
  "3165828788": "3141067569",
  "3165828793": "3141067630",
  "3165828801": "3143836988",
  "3165828803": "3143850415",
  "3165828805": "3143850434",
  "3165828806": "3143850454",
  "3165828807": "3143850495",
  "3165828814": "3143851184",
  "3165828816": "3143851219",
  "3165828817": "3143851554",
  "3165828818": "3143851591",
  "3165828819": "3143851613",
  "3165828822": "3143851703",
  "3165828823": "3143851752",
  "3165828825": "3143852059",
  "3165889235": "3143850410",
  "3166628631": "3126431258"
});

const REMAP_TARGET_TO_SOURCE = Object.freeze(
  Object.fromEntries(Object.entries(OFFER_ID_REMAP).map(([sourceId, targetId]) => [targetId, sourceId]))
);

// Нові Prom-картки, створені після останньої відомої remap-позиції V13,
// пропускаємо автоматично. Старі товари й відхилені дублікати надалі захищає whitelist.
const AUTO_NEW_AFTER_PROM_ID = 3166628631;

function getTargetOfferId(sourceId) {
  return OFFER_ID_REMAP[String(sourceId)] || String(sourceId);
}

function replaceOfferId(offerXml, targetId) {
  return offerXml.replace(
    /(<offer\b[^>]*\bid=)(["'])([^"']+)(\2)/i,
    (full, prefix, quote) => `${prefix}${quote}${String(targetId)}${quote}`
  );
}


// 1178 товарів, відхилених ROZETKA з причиною "На фото ассортимент"
// (у т.ч. комбіновані причини). Для них прибираємо ТІЛЬКИ перше фото,
// але лише якщо в товарі є щонайменше 2 фото.
const PHOTO_FIX_GZIP_BASE64 = "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";

// Точкові вказівки модератора: значення = номер фото в ОРИГІНАЛЬНІЙ галереї Prom, яке треба видалити.
const POSITION_FIX = Object.freeze({
  "3139690833": 2,
  "3140239789": 2,
  "3140239767": 2,
  "3141597237": 3,
  "3140239762": 2,
  "3140239784": 2,
  "3139691319": 2,
  "3139691376": 2,
  "3140239779": 2,
  "3140239793": 2,
  "3140239768": 2,
  "3140239783": 2,
  "3141009634": 2,
  "3140239791": 2,
  "3140239785": 2,
  "3140239766": 2,
  "3140239780": 2,
  "3140239757": 2,
  "3140239777": 2,
  "3086427218": 4,
  "3140239792": 2,
  "3140239759": 2,
  "3141597247": 2
});

// Точкові виправлення назв за коментарями модератора.
const TITLE_FIX = Object.freeze({
  "3143852036": {
    "name": "Курточка для собак WAUDOG Clothes рисунок \"Смелость\", S35, В 47-50 см, С 30-33 см",
    "name_ua": "Курточка для собак WAUDOG Clothes малюнок \"Сміливість\", S35, В 47-50 см, С 30-33 см"
  },
  "3143851028": {
    "name": "Курточка-накидка для собак WAUDOG Clothes, рисунок \"Смелость\", XS, А 26 см, B 33-41 см, С 18-26 см",
    "name_ua": "Курточка-накидка для собак WAUDOG Clothes, малюнок \"Сміливість\", XS, А 26 см, B 33-41 см, С 18-26 см"
  },
  "3141614369": {
    "name": "Сумка-переноска Д 303 №3",
    "name_ua": "Сумка-переноска Д 303 №3"
  },
  "3141614403": {
    "name": "Сумка-переноска Д 301 №1",
    "name_ua": "Сумка-переноска Д 301 №1"
  },
  "3141614368": {
    "name": "Сумка-переноска Д 302 №2",
    "name_ua": "Сумка-переноска Д 302 №2"
  },
  "3043483333": {
    "name": "Салфетки для очищения глаз собак и котов GJYGPET Eye Clean, мягкие диски для ухода за зоной вокруг глаз, 120 шт",
    "name_ua": "Серветки для очищення очей собак і котів GJYGPET Eye Clean, м’які диски для догляду за зоною навколо очей 120 шт"
  }
});




function cdataSafe(value) {
  return String(value ?? "").replace(/\]\]>/g, "]]]]><![CDATA[>");
}

function setTagCdata(xml, tag, value) {
  const content = `<![CDATA[${cdataSafe(value)}]]>`;
  const re = new RegExp(`(<${tag}\\b[^>]*>)[\\s\\S]*?(<\\/${tag}>)`, "i");
  if (re.test(xml)) {
    return xml.replace(re, (full, open, close) => `${open}${content}${close}`);
  }
  return xml.replace(/<\/offer>/i, `<${tag}>${content}</${tag}></offer>`);
}

function applyTitleFix(offerXml, id, stats) {
  const fix = TITLE_FIX[String(id)];
  if (!fix) return offerXml;
  let out = offerXml;
  if (fix.name) out = setTagCdata(out, "name", fix.name);
  if (fix.name_ua) out = setTagCdata(out, "name_ua", fix.name_ua);
  if (stats) stats.titles_fixed = (stats.titles_fixed || 0) + 1;
  return out;
}

async function loadWhitelist() {
  const bytes = Uint8Array.from(
    atob(WHITELIST_GZIP_BASE64),
    c => c.charCodeAt(0)
  );

  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));

  const text = await new Response(stream).text();

  return new Set(
    text.split("\n").map(x => x.trim()).filter(Boolean)
  );
}


async function loadPhotoFixSet() {
  const bytes = Uint8Array.from(
    atob(PHOTO_FIX_GZIP_BASE64),
    c => c.charCodeAt(0)
  );

  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));

  const text = await new Response(stream).text();

  return new Set(
    text.split("\n").map(x => x.trim()).filter(Boolean)
  );
}
async function loadCollarPhotoChoices() {
  const { readFile } = await import("node:fs/promises");

  const text = await readFile(
    new URL("./collar-photo-choices.json", import.meta.url),
    "utf8"
  );

  return JSON.parse(text);
}

function applyCollarPhotoChoice(
  offerXml,
  choice,
  removeOriginalFirst,
  stats
) {
  const pictureRegex = /<picture\b[^>]*>[\s\S]*?<\/picture>/gi;
  const pictures = offerXml.match(pictureRegex) || [];

  if (!pictures.length || !choice) return offerXml;

  const mainPos = Number(choice.main_photo || 0);
  const endPos = Number(choice.end_photo || 0);

  let indexed = pictures.map((tag, index) => ({
    tag,
    position: index + 1
  }));

  // Якщо товар був у старому PHOTO_FIX і вручну НЕ вибране фото №1,
  // старе перше фото прибираємо.
  if (removeOriginalFirst) {
    indexed = indexed.filter(item => item.position !== 1);
    stats.collar_manual_first_removed =
      (stats.collar_manual_first_removed || 0) + 1;
  }

  let main = null;
  let end = null;

  if (mainPos > 0) {
    main = indexed.find(item => item.position === mainPos) || null;
  }

  if (endPos > 0 && endPos !== mainPos) {
    end = indexed.find(item => item.position === endPos) || null;
  }

  let middle = indexed.filter(item => {
    if (main && item.position === main.position) return false;
    if (end && item.position === end.position) return false;
    return true;
  });

  const ordered = [];

  if (main) ordered.push(main);
  ordered.push(...middle);
  if (end) ordered.push(end);

  if (!ordered.length) return offerXml;

  const firstPictureIndex = offerXml.search(pictureRegex);
  if (firstPictureIndex < 0) return offerXml;

  const withoutPictures = offerXml.replace(pictureRegex, "");

  stats.collar_photo_choices_applied =
    (stats.collar_photo_choices_applied || 0) + 1;

  return (
    withoutPictures.slice(0, firstPictureIndex) +
    ordered.map(item => item.tag).join("\n") +
    withoutPictures.slice(firstPictureIndex)
  );
}
function getPictures(offerXml) {
  const out = [];
  const re = /<picture\b[^>]*>([\s\S]*?)<\/picture>/gi;
  let m;
  while ((m = re.exec(offerXml)) !== null) {
    out.push(
      String(m[1] || "")
        .replace(/^<!\[CDATA\[/i, "")
        .replace(/\]\]>$/i, "")
        .trim()
    );
  }
  return out;
}

function removeFirstPicture(offerXml, stats) {
  const matches = offerXml.match(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi) || [];

  if (matches.length < 2) {
    stats.photo_fix_skipped_single++;
    return offerXml;
  }

  let removed = false;
  const updated = offerXml.replace(
    /<picture\b[^>]*>[\s\S]*?<\/picture>/i,
    (full) => {
      if (removed) return full;
      removed = true;
      return "";
    }
  );

  if (removed) stats.first_pictures_removed++;
  return updated;
}

function removePicturePositions(offerXml, positions, stats) {
  const wanted = new Set(Array.from(positions || []).map(Number));
  let index = 0;

  return offerXml.replace(
    /<picture\b[^>]*>[\s\S]*?<\/picture>/gi,
    (full) => {
      index++;
      if (wanted.has(index)) {
        stats.position_pictures_removed++;
        return "";
      }
      return full;
    }
  );
}

function getPositionFixPositions(id, photoFixSet) {
  const requested = POSITION_FIX[String(id)];
  if (!requested) return [];
  const positions = new Set([Number(requested)]);
  // Якщо товар одночасно мав помилку "На фото асортимент", V8 вже прибирає його 1-ше фото.
  // У частковому V9-фіді прибираємо ОБИДВА оригінальні індекси за один прохід,
  // щоб не повернути старе перше фото назад.
  if (photoFixSet && photoFixSet.has(String(id))) positions.add(1);
  return Array.from(positions).sort((a,b) => a-b);
}

function getOfferId(offerXml) {
  const m = offerXml.match(/\bid=(["'])([^"']+)\1/i);
  return m ? m[2].trim() : null;
}

function unwrapPictureValue(innerXml) {
  return String(innerXml || "")
    .replace(/^<!\[CDATA\[/i, "")
    .replace(/\]\]>$/i, "")
    .trim();
}

// V11/V13: робимо URL картинок Prom стабільними.
// Prom може віддавати те саме фото як:
//   https://images.prom.ua/HASH=/7514262066_name.jpg
// а Pricecreator/Rozetka вже має:
//   https://images.prom.ua/7514262066_name.jpg
// Для Rozetka це два різні URL, тому вона могла додавати фото повторно.
// Тут обидва варіанти приводяться до одного прямого URL за ім'ям файлу.
function normalizePictureUrl(innerXml) {
  const value = unwrapPictureValue(innerXml);

  try {
    const u = new URL(value);
    const parts = decodeURIComponent(u.pathname)
      .split("/")
      .filter(Boolean);
    const fileName = parts.at(-1) || "";

    if (u.hostname.toLowerCase() === "images.prom.ua" && fileName) {
      return `https://images.prom.ua/${encodeURI(fileName)}`;
    }

    return value;
  } catch {
    return value;
  }
}

function getPictureKey(innerXml) {
  const normalized = normalizePictureUrl(innerXml);

  try {
    const u = new URL(normalized);
    const parts = decodeURIComponent(u.pathname)
      .split("/")
      .filter(Boolean);
    return (parts.at(-1) || normalized).toLowerCase();
  } catch {
    const clean = normalized.split("?")[0].split("#")[0];
    const parts = clean.split("/").filter(Boolean);
    return (parts.at(-1) || clean).toLowerCase();
  }
}

function dedupePictures(offerXml, stats) {
  const seen = new Set();

  return offerXml.replace(
    /(<picture\b[^>]*>)([\s\S]*?)(<\/picture>)/gi,
    (full, openTag, inner, closeTag) => {
      stats.pictures_before++;

      const key = getPictureKey(inner);
      const normalizedUrl = normalizePictureUrl(inner);
      const originalUrl = unwrapPictureValue(inner);

      if (seen.has(key)) {
        stats.duplicate_pictures_removed++;
        return "";
      }

      seen.add(key);
      stats.pictures_after++;

      if (normalizedUrl !== originalUrl) {
        stats.picture_urls_canonicalized =
          (stats.picture_urls_canonicalized || 0) + 1;
        return `${openTag}${normalizedUrl}${closeTag}`;
      }

      return full;
    }
  );
}

// Не переносимо акції/знижки з Prom на Rozetka.
// Prom може передавати стару/звичайну ціну різними тегами:
// <oldprice>, <price_old>, <priceold>, <old_price>.
// Також прибираємо <price_promo>.
// Якщо, наприклад, Prom віддав <price>198</price><price_old>220</price_old>,
// для Rozetka залишаємо <price>220</price> без акційних тегів.
const OLD_PRICE_TAGS = ["oldprice", "price_old", "priceold", "old_price"];

function getTagValue(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function removeTag(xml, tag) {
  const re = new RegExp(`\\s*<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
  return xml.replace(re, "");
}

function setMainPrice(xml, value) {
  const priceRegex = /(<price\b[^>]*>)[\s\S]*?(<\/price>)/i;
  if (priceRegex.test(xml)) {
    return xml.replace(priceRegex, (full, openTag, closeTag) =>
      `${openTag}${value}${closeTag}`
    );
  }

  // Захисний варіант для нетипового XML без <price>.
  return xml.replace(/(<offer\b[^>]*>)/i, `$1<price>${value}</price>`);
}
function applyRozetkaMarkup(offerXml, stats) {
  const priceRaw = getTagValue(offerXml, "price");
  if (!priceRaw) return offerXml;

  const price = Number(
    String(priceRaw)
      .replace(/\s/g, "")
      .replace(",", ".")
  );

  if (!Number.isFinite(price) || price <= 0) {
    return offerXml;
  }

  const vendor = String(getTagValue(offerXml, "vendor") || "")
    .trim()
    .toLowerCase();

  // Товари Collar / CoLLaR — без націнки
  if (vendor === "collar") {
    return offerXml;
  }

  let percent;

  if (price <= 500) {
    percent = 0.07;
  } else if (price <= 1500) {
    percent = 0.05;
  } else {
    percent = 0.03;
  }

  const newPrice = Math.round(price * (1 + percent));

  if (newPrice !== price) {
    stats.prices_marked_up = (stats.prices_marked_up || 0) + 1;
  }

  return setMainPrice(offerXml, String(newPrice));
}
function removePromDiscount(offerXml, stats) {
  let updated = offerXml;

  let regularPrice = null;
  for (const tag of OLD_PRICE_TAGS) {
    const value = getTagValue(updated, tag);
    if (value) {
      regularPrice = value;
      break;
    }
  }

  const promoPrice = getTagValue(updated, "price_promo");
  let changed = false;

  // Якщо є стара/звичайна ціна — саме її робимо основною.
  if (regularPrice) {
    const currentPrice = getTagValue(updated, "price");
    if (currentPrice !== regularPrice) {
      updated = setMainPrice(updated, regularPrice);
    }
    changed = true;
  }

  // Прибираємо всі варіанти старої ціни і promo-ціну,
  // щоб Rozetka бачила лише одну звичайну <price>.
  for (const tag of OLD_PRICE_TAGS) {
    if (getTagValue(updated, tag) !== null) changed = true;
    updated = removeTag(updated, tag);
  }

  if (promoPrice !== null) {
    changed = true;
    updated = removeTag(updated, "price_promo");
  }

  if (changed) stats.discounts_removed++;
  return updated;
}

function getPriceSnapshot(offerXml) {
  const out = {};
  for (const tag of ["price", ...OLD_PRICE_TAGS, "price_promo"]) {
    const value = getTagValue(offerXml, tag);
    if (value !== null) out[tag] = value;
  }
  return out;
}

async function debugOffer(offerId) {
  const photoFixSet = await loadPhotoFixSet();

  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "D&D-Home-Pets-Rozetka-Feed/13.0",
      "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!response.ok) {
    throw new Error(`Source feed HTTP ${response.status}`);
  }

  const xml = await response.text();
  const offerRegex = /<offer\b[\s\S]*?<\/offer>/gi;
  let match;

  while ((match = offerRegex.exec(xml)) !== null) {
    const offer = match[0];
    const id = getOfferId(offer);
    if (id !== String(offerId)) continue;

    const tmpStats = {
      discounts_removed: 0,
      first_pictures_removed: 0,
      photo_fix_skipped_single: 0,
      pictures_before: 0,
      pictures_after: 0,
      duplicate_pictures_removed: 0,
    };

    let after = removePromDiscount(offer, tmpStats);
    const targeted = photoFixSet.has(String(offerId));

    if (targeted) {
      after = removeFirstPicture(after, tmpStats);
    }

    after = dedupePictures(after, tmpStats);

    return {
      id: String(offerId),
      found: true,
      photo_fix_target: targeted,
      pictures_before: getPictures(offer),
      pictures_after: getPictures(after),
      first_pictures_removed: tmpStats.first_pictures_removed,
      photo_fix_skipped_single: tmpStats.photo_fix_skipped_single,
      duplicate_pictures_removed: tmpStats.duplicate_pictures_removed,
      prices_before: getPriceSnapshot(offer),
      prices_after: getPriceSnapshot(after),
      discounts_removed: tmpStats.discounts_removed,
    };
  }

  return { id: String(offerId), found: false };
}


async function debugIdRemap(sourceOfferId) {
  const idWanted = String(sourceOfferId);
  const targetId = getTargetOfferId(idWanted);
  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "D&D-Home-Pets-Rozetka-Feed/13.0",
      "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!response.ok) throw new Error(`Source feed HTTP ${response.status}`);
  const xml = await response.text();
  const re = /<offer\b[\s\S]*?<\/offer>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const offer = m[0];
    const sourceId = getOfferId(offer);
    if (sourceId !== idWanted) continue;
    return {
      source_id: idWanted,
      target_rozetka_offerid: targetId,
      remapped: targetId !== idWanted,
      source_found: true,
      source_name: getTagValue(offer, "name"),
      source_name_ua: getTagValue(offer, "name_ua"),
      source_price: getTagValue(offer, "price"),
    };
  }
  return {
    source_id: idWanted,
    target_rozetka_offerid: targetId,
    remapped: targetId !== idWanted,
    source_found: false,
  };
}

async function buildFeed() {
  const [whitelist, photoFixSet] = await Promise.all([
    loadWhitelist(),
    loadPhotoFixSet(),
  ]);
const collarPhotoChoices = await loadCollarPhotoChoices();
  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "D&D-Home-Pets-Rozetka-Feed/13.0",
      "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Prom XML error: ${response.status} ${response.statusText}`
    );
  }

  const xml = await response.text();
  const offersStart = xml.indexOf("<offers>");
  const offersEnd = xml.indexOf("</offers>");

  if (offersStart < 0 || offersEnd < 0 || offersEnd <= offersStart) {
    throw new Error("Prom XML has no <offers> block");
  }

  const head = xml.slice(0, offersStart + "<offers>".length);
  const offersXml = xml.slice(offersStart + "<offers>".length, offersEnd);
  const tail = xml.slice(offersEnd);

  const stats = {
    whitelist: whitelist.size,
    source_offers: 0,
    matched_whitelist: 0,
    missing_whitelist: 0,
    generated_offers: 0,
    excluded_offers: 0,
    group_id_removed: 0,
    pictures_before: 0,
    pictures_after: 0,
    duplicate_pictures_removed: 0,
    picture_urls_canonicalized: 0,
    discounts_removed: 0,
    photo_fix_list: photoFixSet.size,
    photo_fix_matched: 0,
    first_pictures_removed: 0,
    photo_fix_skipped_single: 0,
    title_fix_list: Object.keys(TITLE_FIX).length,
    titles_fixed: 0,
    remap_list: Object.keys(OFFER_ID_REMAP).length,
    remapped_offers: 0,
    stale_old_source_skipped: 0,
    duplicate_target_ids_skipped: 0,
    auto_new_after_prom_id: AUTO_NEW_AFTER_PROM_ID,
    auto_new_offers: 0,
  };

  // Спочатку збираємо всі OFFERID, які реально є у поточному Prom XML.
  // Це потрібно для 2 випадків, де одночасно існує стара і нова картка Prom:
  // якщо нова картка є, беремо саме її дані, але віддаємо старий OFFERID Rozetka.
  const sourceIds = new Set();
  const rawOffers = [];
  const offerRegex = /<offer\b[\s\S]*?<\/offer>/gi;
  let match;

  while ((match = offerRegex.exec(offersXml)) !== null) {
    stats.source_offers++;
    const offer = match[0];
    const sourceId = getOfferId(offer);
    if (sourceId) sourceIds.add(sourceId);
    rawOffers.push({ offer, sourceId });
  }

  const kept = [];
  const seenTargetIds = new Set();

  for (const item of rawOffers) {
    let offer = item.offer;
    const sourceId = item.sourceId;
    if (!sourceId) {
      stats.excluded_offers++;
      continue;
    }

    const mappedSourceForThisOldId = REMAP_TARGET_TO_SOURCE[sourceId];
    if (mappedSourceForThisOldId && sourceIds.has(mappedSourceForThisOldId)) {
      // Стара картка Prom ще існує, але є і нова пересоздана.
      // Пропускаємо старе джерело, щоб не отримати два однакові target OFFERID.
      stats.stale_old_source_skipped++;
      continue;
    }

    const targetId = getTargetOfferId(sourceId);
    const isRemapped = targetId !== sourceId;

    // Старі/відомі картки пропускаємо тільки через whitelist.
    // Нові звичайні Prom-картки після контрольного ID V13 додаємо автоматично.
    // Відомі пересоздані картки все одно йдуть через OFFER_ID_REMAP до старого Rozetka OFFERID.
    const isWhitelisted = whitelist.has(targetId);
    const sourceIdNumber = Number(sourceId);
    const isAutoNew =
      !isRemapped &&
      Number.isSafeInteger(sourceIdNumber) &&
      sourceIdNumber > AUTO_NEW_AFTER_PROM_ID;

    if (!isWhitelisted && !isAutoNew) {
      stats.excluded_offers++;
      continue;
    }

    if (seenTargetIds.has(targetId)) {
      stats.duplicate_target_ids_skipped++;
      continue;
    }

    seenTargetIds.add(targetId);
    if (isWhitelisted) stats.matched_whitelist++;
    if (isAutoNew) stats.auto_new_offers++;

    if (isRemapped) {
      offer = replaceOfferId(offer, targetId);
      stats.remapped_offers++;
    }

    const groupMatches = offer.match(/\s+group_id=(["'])[^"']*\1/g);
    if (groupMatches) {
      stats.group_id_removed += groupMatches.length;
      offer = offer.replace(/\s+group_id=(["'])[^"']*\1/g, "");
    }

    offer = removePromDiscount(offer, stats);
    offer = applyRozetkaMarkup(offer, stats);

    // Всі точкові правила застосовуємо за СТАРИМ target OFFERID,
    // бо саме до нього прив'язані модерація й картка Rozetka.
 const collarPhotoChoice =
  collarPhotoChoices[String(targetId)] || null;

const isPhotoFixTarget = photoFixSet.has(targetId);

if (isPhotoFixTarget) {
  stats.photo_fix_matched++;
}

if (collarPhotoChoice) {
  const removeOriginalFirst =
    isPhotoFixTarget &&
    Number(collarPhotoChoice.main_photo || 0) !== 1;

  offer = applyCollarPhotoChoice(
    offer,
    collarPhotoChoice,
    removeOriginalFirst,
    stats
  );
} else if (isPhotoFixTarget) {
  offer = removeFirstPicture(offer, stats);
}

    offer = applyTitleFix(offer, targetId, stats);
    offer = dedupePictures(offer, stats);
    kept.push(offer);
  }

  stats.missing_whitelist = Array.from(whitelist).reduce(
    (n, id) => n + (seenTargetIds.has(id) ? 0 : 1),
    0
  );
  stats.generated_offers = kept.length;

  const result = head + "\n" + kept.join("\n") + "\n" + tail;
  return { xml: result, stats };
}

// Окремий безпечний фід лише для виправлення фото.
// Він містить тільки товари зі списку PHOTO_FIX, які зараз є у джерелі,
// входять у whitelist і мають щонайменше 2 фото. Для них перше фото
// прибирається, друге стає головним. Інші товари сюди не потрапляють.
async function buildPhotoFixFeed() {
  const [whitelist, photoFixSet] = await Promise.all([
    loadWhitelist(),
    loadPhotoFixSet(),
  ]);

  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "D&D-Home-Pets-Rozetka-Feed/13.0",
      "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!response.ok) {
    throw new Error(
      `Prom XML error: ${response.status} ${response.statusText}`
    );
  }

  const xml = await response.text();
  const offersStart = xml.indexOf("<offers>");
  const offersEnd = xml.indexOf("</offers>");

  if (offersStart < 0 || offersEnd < 0 || offersEnd <= offersStart) {
    throw new Error("Prom XML has no <offers> block");
  }

  const head = xml.slice(0, offersStart + "<offers>".length);
  const offersXml = xml.slice(
    offersStart + "<offers>".length,
    offersEnd
  );
  const tail = xml.slice(offersEnd);

  const stats = {
    photo_fix_list: photoFixSet.size,
    source_offers: 0,
    matched_photo_fix: 0,
    matched_whitelist: 0,
    generated_offers: 0,
    missing_or_not_in_source: 0,
    not_in_whitelist: 0,
    skipped_single_picture: 0,
    first_pictures_removed: 0,
    group_id_removed: 0,
    pictures_before: 0,
    pictures_after: 0,
    duplicate_pictures_removed: 0,
    discounts_removed: 0,
  };

  const kept = [];
  const seenTargetIds = new Set();
  const offerRegex = /<offer\b[\s\S]*?<\/offer>/gi;
  let match;

  while ((match = offerRegex.exec(offersXml)) !== null) {
    stats.source_offers++;

    let offer = match[0];
    const id = getOfferId(offer);
    if (!id || !photoFixSet.has(id)) continue;

    stats.matched_photo_fix++;
    seenTargetIds.add(id);

    if (!whitelist.has(id)) {
      stats.not_in_whitelist++;
      continue;
    }
    stats.matched_whitelist++;

    const sourcePictures = getPictures(offer);
    if (sourcePictures.length < 2) {
      stats.skipped_single_picture++;
      continue;
    }

    const groupMatches =
      offer.match(/\s+group_id=(["'])[^"']*\1/g);

    if (groupMatches) {
      stats.group_id_removed += groupMatches.length;
      offer = offer.replace(
        /\s+group_id=(["'])[^"']*\1/g,
        ""
      );
    }

    offer = removePromDiscount(offer, stats);
    offer = removeFirstPicture(offer, stats);
    offer = dedupePictures(offer, stats);

    kept.push(offer);
  }

  stats.missing_or_not_in_source =
    photoFixSet.size - seenTargetIds.size;
  stats.generated_offers = kept.length;

  const result =
    head +
    "\n" +
    kept.join("\n") +
    "\n" +
    tail;

  return { xml: result, stats };
}


async function debugPositionFix(offerId) {
  const [whitelist, photoFixSet] = await Promise.all([
    loadWhitelist(),
    loadPhotoFixSet(),
  ]);
  const idWanted = String(offerId);
  const requestedPosition = POSITION_FIX[idWanted] || null;

  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "D&D-Home-Pets-Rozetka-Feed/13.0",
      "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!response.ok) throw new Error(`Source feed HTTP ${response.status}`);

  const xml = await response.text();
  const offerRegex = /<offer\b[\s\S]*?<\/offer>/gi;
  let match;
  while ((match = offerRegex.exec(xml)) !== null) {
    const offer = match[0];
    const id = getOfferId(offer);
    if (id !== idWanted) continue;

    const positions = getPositionFixPositions(idWanted, photoFixSet);
    const before = getPictures(offer);
    const stats = {
      discounts_removed: 0,
      position_pictures_removed: 0,
      pictures_before: 0,
      pictures_after: 0,
      duplicate_pictures_removed: 0,
    };
    let after = removePromDiscount(offer, stats);
    after = removePicturePositions(after, positions, stats);
    after = dedupePictures(after, stats);

    return {
      id: idWanted,
      found: true,
      in_whitelist: whitelist.has(idWanted),
      position_fix_target: requestedPosition !== null,
      requested_position: requestedPosition,
      overlap_first_photo_fix: photoFixSet.has(idWanted),
      positions_removed_from_original: positions,
      pictures_before: before,
      pictures_after: getPictures(after),
      position_pictures_removed: stats.position_pictures_removed,
      enough_pictures: positions.length > 0 && before.length >= Math.max(...positions) && (before.length - positions.length) >= 1,
    };
  }
  return { id: idWanted, found: false, position_fix_target: requestedPosition !== null };
}

async function buildPositionFixFeed() {
  const [whitelist, photoFixSet] = await Promise.all([
    loadWhitelist(),
    loadPhotoFixSet(),
  ]);
  const targetIds = new Set(Object.keys(POSITION_FIX));

  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "D&D-Home-Pets-Rozetka-Feed/13.0",
      "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!response.ok) {
    throw new Error(`Prom XML error: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const offersStart = xml.indexOf("<offers>");
  const offersEnd = xml.indexOf("</offers>");
  if (offersStart < 0 || offersEnd < 0 || offersEnd <= offersStart) {
    throw new Error("Prom XML has no <offers> block");
  }

  const head = xml.slice(0, offersStart + "<offers>".length);
  const offersXml = xml.slice(offersStart + "<offers>".length, offersEnd);
  const tail = xml.slice(offersEnd);

  const stats = {
    position_fix_list: targetIds.size,
    source_offers: 0,
    matched_position_fix: 0,
    matched_whitelist: 0,
    generated_offers: 0,
    missing_or_not_in_source: 0,
    not_in_whitelist: 0,
    skipped_insufficient_pictures: 0,
    overlap_first_photo_fix: 0,
    requested_position_2: Object.values(POSITION_FIX).filter(x => x === 2).length,
    requested_position_3: Object.values(POSITION_FIX).filter(x => x === 3).length,
    requested_position_4: Object.values(POSITION_FIX).filter(x => x === 4).length,
    position_pictures_removed: 0,
    group_id_removed: 0,
    pictures_before: 0,
    pictures_after: 0,
    duplicate_pictures_removed: 0,
    discounts_removed: 0,
  };

  const kept = [];
  const seenTargetIds = new Set();
  const offerRegex = /<offer\b[\s\S]*?<\/offer>/gi;
  let match;

  while ((match = offerRegex.exec(offersXml)) !== null) {
    stats.source_offers++;
    let offer = match[0];
    const id = getOfferId(offer);
    if (!id || !targetIds.has(id)) continue;

    stats.matched_position_fix++;
    seenTargetIds.add(id);

    if (!whitelist.has(id)) {
      stats.not_in_whitelist++;
      continue;
    }
    stats.matched_whitelist++;

    const positions = getPositionFixPositions(id, photoFixSet);
    if (photoFixSet.has(id)) stats.overlap_first_photo_fix++;
    const sourcePictures = getPictures(offer);
    const maxPos = positions.length ? Math.max(...positions) : 0;

    // Не віддаємо товар, якщо потрібного номера фото немає або після видалення не лишиться жодного фото.
    if (!positions.length || sourcePictures.length < maxPos || (sourcePictures.length - positions.length) < 1) {
      stats.skipped_insufficient_pictures++;
      continue;
    }

    const groupMatches = offer.match(/\s+group_id=(["'])[^"']*\1/g);
    if (groupMatches) {
      stats.group_id_removed += groupMatches.length;
      offer = offer.replace(/\s+group_id=(["'])[^"']*\1/g, "");
    }

    offer = removePromDiscount(offer, stats);
    offer = removePicturePositions(offer, positions, stats);
    offer = dedupePictures(offer, stats);
    kept.push(offer);
  }

  stats.missing_or_not_in_source = targetIds.size - seenTargetIds.size;
  stats.generated_offers = kept.length;

  const result = head + "\n" + kept.join("\n") + "\n" + tail;
  return { xml: result, stats };
}



async function buildTitleFixFeed() {
  const whitelist = await loadWhitelist();
  const targetIds = new Set(Object.keys(TITLE_FIX));

  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "D&D-Home-Pets-Rozetka-Feed/13.0",
      "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!response.ok) {
    throw new Error(`Prom XML error: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const offersStart = xml.indexOf("<offers>");
  const offersEnd = xml.indexOf("</offers>");
  if (offersStart < 0 || offersEnd < 0 || offersEnd <= offersStart) {
    throw new Error("Prom XML has no <offers> block");
  }

  const head = xml.slice(0, offersStart + "<offers>".length);
  const offersXml = xml.slice(offersStart + "<offers>".length, offersEnd);
  const tail = xml.slice(offersEnd);

  const stats = {
    title_fix_list: targetIds.size,
    source_offers: 0,
    matched_title_fix: 0,
    matched_whitelist: 0,
    generated_offers: 0,
    missing_or_not_in_source: 0,
    not_in_whitelist: 0,
    titles_fixed: 0,
    group_id_removed: 0,
    discounts_removed: 0,
  };

  const kept = [];
  const seenTargetIds = new Set();
  const offerRegex = /<offer\b[\s\S]*?<\/offer>/gi;
  let match;

  while ((match = offerRegex.exec(offersXml)) !== null) {
    stats.source_offers++;
    let offer = match[0];
    const id = getOfferId(offer);
    if (!id || !targetIds.has(id)) continue;

    stats.matched_title_fix++;
    seenTargetIds.add(id);

    if (!whitelist.has(id)) {
      stats.not_in_whitelist++;
      continue;
    }
    stats.matched_whitelist++;

    const groupMatches = offer.match(/\s+group_id=(["'])[^"']*\1/g);
    if (groupMatches) {
      stats.group_id_removed += groupMatches.length;
      offer = offer.replace(/\s+group_id=(["'])[^"']*\1/g, "");
    }

    offer = removePromDiscount(offer, stats);
    offer = applyTitleFix(offer, id, stats);
    kept.push(offer);
  }

  stats.missing_or_not_in_source = targetIds.size - seenTargetIds.size;
  stats.generated_offers = kept.length;
  return { xml: head + "\n" + kept.join("\n") + "\n" + tail, stats };
}
async function buildCollarPhotoReport() {
  const photoFixSet = await loadPhotoFixSet();

  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "D&D-Home-Pets-Rozetka-Feed/13.0",
      "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Prom XML error: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const offerRegex = /<offer\b[\s\S]*?<\/offer>/gi;
  const report = [];

  let match;
  while ((match = offerRegex.exec(xml)) !== null) {
    const offer = match[0];

    const vendor = String(getTagValue(offer, "vendor") || "")
      .trim()
      .toLowerCase();

    if (vendor !== "collar") continue;

    const sourceId = getOfferId(offer);
    const targetId = getTargetOfferId(sourceId);
    const pictures = getPictures(offer);

    report.push({
      source_id: sourceId,
      rozetka_offer_id: targetId,
      article: getTagValue(offer, "article"),
      name: getTagValue(offer, "name_ua") || getTagValue(offer, "name"),
      photo_fix_target: photoFixSet.has(String(targetId)),
      pictures_count: pictures.length,
      pictures: pictures.map((url, index) => ({
        position: index + 1,
        url,
      })),
    });
  }

  return report;
}
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildCollarPhotoGallery(report) {
  const cards = report.map((item) => {
const images = item.pictures.map((picture) => `
  <div class="photo">
    <div class="position">Фото №${picture.position}</div>

    <img
      src="${escapeHtml(picture.url)}"
      loading="lazy"
      onclick="selectMainPhoto(
        '${escapeHtml(item.rozetka_offer_id)}',
        ${picture.position},
        this
      )"
    >

    <button
      class="main-photo-button"
      onclick="selectMainPhoto(
        '${escapeHtml(item.rozetka_offer_id)}',
        ${picture.position},
        this
      )"
    >
      ⭐ Зробити головним
    </button>
    <button
  class="end-photo-button"
  onclick="selectEndPhoto(
    '${escapeHtml(item.rozetka_offer_id)}',
    ${picture.position},
    this
  )"
>
  📐 В кінець
</button>
  </div>
`).join("");

    return `
      <section
  class="card ${item.photo_fix_target ? "photo-fix" : ""}"
  data-id="${escapeHtml(item.rozetka_offer_id)}"
>
        <div class="info">
          <h2>${escapeHtml(item.name)}</h2>
          <div><b>Rozetka ID:</b> ${escapeHtml(item.rozetka_offer_id)}</div>
          <div><b>Prom ID:</b> ${escapeHtml(item.source_id)}</div>
          <div><b>Артикул:</b> ${escapeHtml(item.article)}</div>
          <div><b>Кількість фото:</b> ${item.pictures_count}</div>
          <div class="status">
            PHOTO_FIX: ${item.photo_fix_target ? "TRUE — перше фото видаляється" : "FALSE"}
          </div>
        </div>
<div class="review-buttons">
  <button onclick="markReview('${escapeHtml(item.rozetka_offer_id)}', 'ok', this)">
    ✅ Фото №1 нормальне
  </button>

  <button onclick="markReview('${escapeHtml(item.rozetka_offer_id)}', 'problem', this)">
    ⚠️ Треба виправити головне фото
  </button>
</div>
        <div class="photos">
          ${images}
        </div>
      </section>
    `;
  }).join("");

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Collar photo report</title>
<style>
  body {
    font-family: Arial, sans-serif;
    margin: 20px;
    background: #f5f5f5;
    color: #222;
  }

  h1 {
    margin-bottom: 8px;
  }

  .note {
    margin-bottom: 25px;
    font-size: 14px;
  }
.filters {
  margin-bottom: 20px;
}

.filters button {
  margin-right: 10px;
  padding: 10px 14px;
  cursor: pointer;
}
.end-photo-button {
  width: 100%;
  margin-top: 4px;
  padding: 7px 5px;
  cursor: pointer;
}

.photo.selected-end img {
  outline: 4px dashed #333;
}

.photo.selected-end .end-photo-button {
  font-weight: bold;
}
.main-photo-button {
  width: 100%;
  margin-top: 6px;
  padding: 7px 5px;
  cursor: pointer;
}

.photo.selected-main img {
  outline: 4px solid #333;
}

.photo.selected-main .main-photo-button {
  font-weight: bold;
}
  .card {
    background: white;
    border: 2px solid #ddd;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 22px;
  }

  .card.photo-fix {
    border-color: #d33;
  }

  .info h2 {
    margin: 0 0 10px;
    font-size: 18px;
  }

  .status {
    margin-top: 8px;
    font-weight: bold;
  }

  .photo-fix .status {
    color: #c00;
  }

  .photos {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 15px;
  }

  .photo {
    width: 190px;
  }

  .photo img {
    width: 190px;
    height: 190px;
    object-fit: contain;
    background: white;
    border: 1px solid #ccc;
  }

  .position {
    font-weight: bold;
    margin-bottom: 5px;
  }
</style>
</head>

<body>
<h1>Collar — перевірка порядку фото</h1>

<div class="note">
Червона рамка = товар входить у PHOTO_FIX і його перше фото зараз видаляється генератором.
Фото показані в оригінальному порядку Prom.
</div>
<div class="filters">
  <button onclick="showAll()">Показати всі</button>
  <button onclick="showPhotoFix()">Тільки PHOTO_FIX: TRUE</button>
   <button onclick="showProblems()">Тільки позначені проблемні</button>
   <button onclick="exportPhotoChoices()">⬇️ Експортувати вибір</button>
</div>
${cards}
<script>
  function showAll() {
    document.querySelectorAll(".card").forEach(card => {
      card.style.display = "";
    });
  }

  function showPhotoFix() {
    document.querySelectorAll(".card").forEach(card => {
      card.style.display = card.classList.contains("photo-fix") ? "" : "none";
    });
  }

  function markReview(id, status, button) {
    localStorage.setItem("collar_review_" + id, status);

    const card = button.closest(".card");
    card.dataset.review = status;

    card.querySelectorAll(".review-buttons button").forEach(btn => {
      btn.style.fontWeight = "normal";
      btn.style.outline = "none";
    });

    button.style.fontWeight = "bold";
    button.style.outline = "3px solid #333";
  }

  function showProblems() {
    document.querySelectorAll(".card").forEach(card => {
      card.style.display = card.dataset.review === "problem" ? "" : "none";
    });
  }
function selectMainPhoto(id, position, element) {
  localStorage.setItem(
    "collar_main_photo_" + id,
    String(position)
  );

  const card = element.closest(".card");

  card.querySelectorAll(".photo").forEach(photo => {
    photo.classList.remove("selected-main");
  });

  const photo = element.closest(".photo");
  photo.classList.add("selected-main");

  card.dataset.mainPhoto = String(position);
}
function selectEndPhoto(id, position, element) {
  localStorage.setItem(
    "collar_end_photo_" + id,
    String(position)
  );

  const card = element.closest(".card");

  card.querySelectorAll(".photo").forEach(photo => {
    photo.classList.remove("selected-end");
  });

  const photo = element.closest(".photo");
  photo.classList.add("selected-end");

  card.dataset.endPhoto = String(position);
}
function exportPhotoChoices() {
  const result = {};

  document.querySelectorAll(".card").forEach(card => {
    const id = card.dataset.id;
    if (!id) return;

    const mainPhoto = localStorage.getItem("collar_main_photo_" + id);
    const endPhoto = localStorage.getItem("collar_end_photo_" + id);
    const review = localStorage.getItem("collar_review_" + id);

    if (mainPhoto || endPhoto || review) {
      result[id] = {
        main_photo: mainPhoto ? Number(mainPhoto) : null,
        end_photo: endPhoto ? Number(endPhoto) : null,
        review: review || null
      };
    }
  });

  const blob = new Blob(
    [JSON.stringify(result, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "collar-photo-choices.json";
  a.click();
  URL.revokeObjectURL(url);
}
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".card").forEach(card => {
      const id = card.dataset.id;
if (!id) return;
      const saved = localStorage.getItem("collar_review_" + id);
const savedMainPhoto = localStorage.getItem("collar_main_photo_" + id);

if (savedMainPhoto) {
  card.dataset.mainPhoto = savedMainPhoto;

  const photos = card.querySelectorAll(".photo");
  const index = Number(savedMainPhoto) - 1;

  if (photos[index]) {
    photos[index].classList.add("selected-main");
  }
}
const savedEndPhoto = localStorage.getItem("collar_end_photo_" + id);

if (savedEndPhoto) {
  card.dataset.endPhoto = savedEndPhoto;

  const photos = card.querySelectorAll(".photo");
  const index = Number(savedEndPhoto) - 1;

  if (photos[index]) {
    photos[index].classList.add("selected-end");
  }
}
      if (saved) {
        card.dataset.review = saved;

        const buttons = card.querySelectorAll(".review-buttons button");

        if (saved === "ok" && buttons[0]) {
          buttons[0].style.fontWeight = "bold";
          buttons[0].style.outline = "3px solid #333";
        }

        if (saved === "problem" && buttons[1]) {
          buttons[1].style.fontWeight = "bold";
          buttons[1].style.outline = "3px solid #333";
        }
      }
    });
  });
</script>
</body>
</html>`;
}// GitHub Actions CLI entry point: формує статичний feed.xml без Cloudflare CPU-ліміту.
async function main() {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { xml, stats } = await buildFeed();
const collarPhotoReport = await buildCollarPhotoReport();
const collarPhotoGallery = buildCollarPhotoGallery(collarPhotoReport);  // Мінімальні запобіжники перед публікацією.
  if (!xml.includes("<offers>") || !xml.includes("</offers>")) {
    throw new Error("Generated XML has no <offers> block");
  }
  if (stats.generated_offers < 3000) {
    throw new Error(`Safety stop: only ${stats.generated_offers} offers generated`);
  }

  await mkdir("_site", { recursive: true });
  await writeFile("_site/feed.xml", xml, "utf8");
  await writeFile("_site/stats.json", JSON.stringify(stats, null, 2) + "\n", "utf8");
await writeFile(
  "_site/collar-photo-report.json",
  JSON.stringify(collarPhotoReport, null, 2) + "\n",
  "utf8"
);
  await writeFile(
  "_site/collar-photo-gallery.html",
  collarPhotoGallery,
  "utf8"
);
  console.log("Rozetka feed generated successfully");
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

import fs from "node:fs";

const IDS_FILE = "excluded-offerids.txt";
const FEED_FILE = "_site/feed.xml";

const excluded = new Set(
  fs.readFileSync(IDS_FILE, "utf8")
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
);

let xml = fs.readFileSync(FEED_FILE, "utf8");
let removed = 0;

for (const id of excluded) {
  const patterns = [
    new RegExp(`<offer\\b[^>]*\\bid=["']${id}["'][\\s\\S]*?<\\/offer>\\s*`, "g"),
    new RegExp(`<offer\\b[^>]*\\bofferid=["']${id}["'][\\s\\S]*?<\\/offer>\\s*`, "g")
  ];
  for (const pattern of patterns) {
    xml = xml.replace(pattern, (m) => {
      removed += 1;
      return "";
    });
  }
}

fs.writeFileSync(FEED_FILE, xml, "utf8");

for (const id of excluded) {
  if (xml.includes(`id=\"${id}\"`) || xml.includes(`id='${id}'`) || xml.includes(`offerid=\"${id}\"`) || xml.includes(`offerid='${id}'`)) {
    throw new Error(`Safety stop: excluded OFFERID ${id} is still present in feed`);
  }
}

console.log(`Excluded OFFERIDs: ${[...excluded].join(", ")}`);
console.log(`Removed offer blocks: ${removed}`);

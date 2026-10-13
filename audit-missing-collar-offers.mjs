// REPORT-ONLY: compares the current final XML with the last published one.
// Never changes _site/feed.xml, stock, availability, prices or photos.
import fs from "node:fs";
import zlib from "node:zlib";
const REPORT = "_site/missing-collar-offers-audit.json";
const PREVIOUS_URL = "https://homepetsdd-glitch.github.io/ddhomepets-rozetka-feed/feed.xml";
const currentXml = fs.readFileSync("_site/feed.xml", "utf8");
const readLines = (p) => new Set(fs.readFileSync(p, "utf8").split(/\r?\n/).map(x => x.trim()).filter(Boolean));
const own = readLines("own-manual-collar-vendorcodes.txt");
const excluded = readLines("excluded-offerids.txt");
const dropship = new Set(zlib.gunzipSync(Buffer.from(fs.readFileSync("collar-dropship-vendorcodes.gz.b64", "utf8").trim(), "base64")).toString("utf8").split(/\r?\n/).map(x=>x.trim()).filter(Boolean));
function tag(xml, name) {
  const m = xml.match(new RegExp("<" + name + "\\b[^>]*>([\\s\\S]*?)<\\/" + name + ">", "i"));
  return m ? m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim() : "";
}
function offers(xml) {
  return (xml.match(/<offer\b[\s\S]*?<\/offer>/gi) || []).map(block => {
    const m = block.match(/<offer\b[^>]*\bid=(["'])([^"']+)\1/i);
    return {id:m?.[2] || "", article:tag(block,"article") || tag(block,"vendorCode"), stock:Number(tag(block,"stock_quantity") || tag(block,"quantity_in_stock") || 0), available:/<offer\b[^>]*\bavailable=["']true["']/i.test(block)};
  }).filter(x=>x.id);
}
const current = offers(currentXml);
const ids = new Set(current.map(x=>x.id));
let report = {mode:"report_only", generated_at:new Date().toISOString(), reference:PREVIOUS_URL, current_offers:current.length, warnings:[], missing:[]};
try {
  const response = await fetch(PREVIOUS_URL, {headers:{"Cache-Control":"no-cache"}});
  if (!response.ok) throw new Error("Previous feed HTTP " + response.status);
  const previous = offers(await response.text());
  if (previous.length < 3000 || current.length < 3000) throw new Error("Incomplete feed: previous=" + previous.length + ", current=" + current.length);
  report.previous_offers = previous.length;
  report.missing = previous.filter(x => !ids.has(x.id) && x.article && dropship.has(x.article) && !own.has(x.article) && !excluded.has(x.id));
  if (report.missing.length > 100) report.warnings.push("More than 100 offers missing: investigate source completeness before any action.");
} catch (e) {
  report.warnings.push("Comparison unavailable: " + String(e.message || e));
}
fs.writeFileSync(REPORT, JSON.stringify(report,null,2)+"\n","utf8");
console.log("REPORT ONLY - no availability changes. Missing Collar offers:",report.missing.length,"warnings:",report.warnings.join("; "));

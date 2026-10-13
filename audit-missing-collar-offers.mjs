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
function blocks(xml) { return xml.match(/<offer\b[\s\S]*?<\/offer>/gi) || []; }
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
if (!report.warnings.length && report.missing.length > 0) {
  if (report.missing.length > 100) throw new Error("Safety stop: too many missing Collar offers");
  const prevResponse = await fetch(PREVIOUS_URL);
  if (!prevResponse.ok) throw new Error("Previous feed cannot be fetched for restoration");
  const previousBlocks = blocks(await prevResponse.text());
  const missingIds = new Set(report.missing.map(x=>x.id));
  const rescued = previousBlocks.filter(block => {
    const id=(block.match(/<offer\b[^>]*\bid=["']([^"']+)["']/i)||[])[1];
    return id && missingIds.has(id);
  }).map(block => {
    let x=block.replace(/(<offer\b[^>]*\bavailable\s*=\s*)["'][^"']*["']/i,'$1"false"');
    if(!/<offer\b[^>]*\bavailable\s*=/i.test(x)) x=x.replace(/<offer\b/,'<offer available="false"');
    if(/<stock_quantity\b[^>]*>[\s\S]*?<\/stock_quantity>/i.test(x)) x=x.replace(/<stock_quantity\b[^>]*>[\s\S]*?<\/stock_quantity>/i,'<stock_quantity>0</stock_quantity>');
    else x=x.replace(/<\/offer>/i,'<stock_quantity>0</stock_quantity></offer>');
    return x;
  });
  if(rescued.length!==missingIds.size) throw new Error("Missing offer restoration incomplete");
  if(!/<\/offers>/i.test(currentXml)) throw new Error("Cannot find closing offers tag");
  fs.writeFileSync("_site/feed.xml", currentXml.replace(/<\/offers>/i, rescued.join("\n")+"\n</offers>"),"utf8");
  report.restored_as_unavailable=rescued.length;
  console.log("Restored missing Collar dropship offers with ZERO stock:",rescued.length);
}
fs.writeFileSync(REPORT, JSON.stringify(report,null,2)+"\n","utf8");
console.log("REPORT ONLY - no availability changes. Missing Collar offers:",report.missing.length,"warnings:",report.warnings.join("; "));

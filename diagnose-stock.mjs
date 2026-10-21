import fs from "node:fs";
const ids = ["3188796849", "3151715988"];
function find(xml, id) {
  const offers = xml.match(/<offer\b[\s\S]*?<\/offer>/gi) || [];
  const offer = offers.find(x => x.match(/<offer\b[^>]*\bid=["']([^"']+)["']/i)?.[1] === id);
  if (!offer) return { found: false };
  const read = name => offer.match(new RegExp("<" + name + "\\b[^>]*>([\\s\\S]*?)<\\/" + name + ">", "i"))?.[1] ?? null;
  return { found: true, stock_quantity: read("stock_quantity"), quantity_in_stock: read("quantity_in_stock"), quantity: read("quantity") };
}
const source = process.env.PROM_SOURCE_URL;
if (!source) throw Error("PROM_SOURCE_URL not set");
const response = await fetch(source, { headers: { "Cache-Control": "no-cache" } });
if (!response.ok) throw Error("Source HTTP " + response.status);
const upstream = await response.text();
const output = fs.readFileSync("_site/feed.xml", "utf8");
for (const id of ids) console.log("Stock diagnostic", id, JSON.stringify({ source: find(upstream,id), output: find(output,id) }));

/* Loghi dei clienti: l'icona del sito del loro dominio, scaricata una volta e tenuta in data/logos.
   Se il sito non ha un'icona vera (solo il mondo generico 16x16) il logo risulta assente e l'app mostra le iniziali. */
const fs = require("fs");
const path = require("path");
const cfg = require("./config");

const DIR = path.join(cfg.dataDir, "logos");
const VALID = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const MAX_AGE = 1000 * 60 * 60 * 24 * 30;

function pngWidth(buf) {
  const sig = "89504e470d0a1a0a";
  return buf.length > 24 && buf.slice(0, 8).toString("hex") === sig ? buf.readUInt32BE(16) : 0;
}
async function download(domain) {
  const r = await fetch("https://www.google.com/s2/favicons?sz=128&domain=" + encodeURIComponent(domain));
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  const w = pngWidth(buf);
  if (w && w <= 16) return null;           /* icona generica: nessun logo */
  return { buf, type: r.headers.get("content-type") || "image/png" };
}
/* restituisce { buf, type } oppure null */
async function get(domain) {
  domain = String(domain || "").toLowerCase();
  if (!VALID.test(domain)) return null;
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, domain), none = file + ".none";
  for (const f of [file, none]) {
    if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < MAX_AGE) {
      return f === none ? null : { buf: fs.readFileSync(f), type: fs.readFileSync(f + ".type", "utf8") };
    }
  }
  let got = null;
  try { got = await download(domain); } catch (e) { return null; /* niente rete: riprova la prossima volta */ }
  if (got) { fs.writeFileSync(file, got.buf); fs.writeFileSync(file + ".type", got.type); try { fs.unlinkSync(none); } catch (e) {} }
  else fs.writeFileSync(none, "");
  return got;
}
module.exports = { get, pngWidth, VALID };

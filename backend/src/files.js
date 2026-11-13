/* Allegati dei messaggi (foto, video, documenti): salvati in data/files, nel messaggio restano solo nome, tipo e dimensione. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cfg = require("./config");

const DIR = () => path.join(cfg.dataDir, "files");
const MAX = 12 * 1024 * 1024;            /* 12 MB per file */
const OK = /^(image\/|video\/|audio\/|application\/pdf$|text\/plain$|application\/(msword|vnd\.openxmlformats-officedocument\.|vnd\.ms-excel|vnd\.oasis\.opendocument\.|zip$))/;
const safeName = n => String(n || "allegato").replace(/[^\w.\- àèéìòù]+/gi, "_").slice(0, 80) || "allegato";

/* da [{name, type, data(base64)}] a {saved:[{id,name,type,size}], mail:[...stessi con data per l'allegato in mail]} */
function save(list) {
  const saved = [], mail = [];
  for (const f of (Array.isArray(list) ? list : []).slice(0, 10)) {
    if (!f || !f.data) continue;
    const type = String(f.type || "application/octet-stream").toLowerCase();
    if (!OK.test(type)) return { error: "tipo di file non ammesso: " + type };
    const buf = Buffer.from(String(f.data), "base64");
    if (!buf.length) continue;
    if (buf.length > MAX) return { error: "«" + safeName(f.name) + "» supera 12 MB" };
    const id = crypto.randomBytes(12).toString("hex");
    fs.mkdirSync(DIR(), { recursive: true });
    fs.writeFileSync(path.join(DIR(), id), buf);
    fs.writeFileSync(path.join(DIR(), id + ".json"), JSON.stringify({ name: safeName(f.name), type, size: buf.length }));
    saved.push({ id, name: safeName(f.name), type, size: buf.length });
    mail.push({ name: safeName(f.name), type, data: f.data });
  }
  return { saved, mail };
}
function get(id) {
  if (!/^[a-f0-9]{24}$/.test(String(id))) return null;
  const p = path.join(DIR(), id);
  if (!fs.existsSync(p)) return null;
  return { meta: JSON.parse(fs.readFileSync(p + ".json", "utf8")), file: p };
}
module.exports = { save, get, MAX };

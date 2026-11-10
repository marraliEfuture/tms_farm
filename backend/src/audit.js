/* Registro attività: chi ha fatto cosa e quando (data/audit.json, ultime 5000 voci). */
const fs = require("fs");
const path = require("path");
const cfg = require("./config");
const FILE = path.join(cfg.dataDir, "audit.json");
function list() { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return []; } }
function add(user, azione, dettaglio, area) {
  const l = list();
  l.unshift({ at: new Date().toISOString(), user: user || "—", azione, dettaglio: String(dettaglio || "").slice(0, 300), area: area || "" });
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(l.slice(0, 5000)));
}
module.exports = { list, add };

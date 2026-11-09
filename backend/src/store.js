/* Archivio semplice su file JSON (data/state.json): conversazioni dei tecnici, registro delle mail, regole. */
const fs = require("fs");
const path = require("path");
const cfg = require("./config");

const FILE = path.join(cfg.dataDir, "state.json");
const DEFAULT_RULES = [
  { k: "reply", t: "Risposta a una mail del ticket", d: "In-Reply-To o References contiene l'identificativo di una mail mandata da ITSM o Halo", on: true },
  { k: "subj", t: "Numero del ticket nell'oggetto", d: "Oggetto con «Tck #714139» (ITSM) o «HALO-4821» (Halo)", on: true },
  { k: "hdr", t: "Cliente indicato dall'app del tecnico", d: "Intestazione X-TicketFarm-Cliente nelle mail che partono dall'app", on: true },
  { k: "from", t: "Mittente è un contatto noto", d: "Indirizzo presente nei contatti di ITSM, Halo o Office 365", on: true },
  { k: "dom", t: "Dominio del mittente", d: "Es. @caseificiovalle.ch porta a Caseificio Valle SA", on: true },
];

let state = null;
function load() {
  if (state) return state;
  try { state = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { state = {}; }
  state.threads = state.threads || {};
  state.mails = state.mails || [];
  state.phones = state.phones || {};
  state.seq = state.seq || 30;
  state.rules = state.rules || DEFAULT_RULES;
  return state;
}
function save() {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(state, null, 1));
  fs.renameSync(FILE + ".tmp", FILE);
}
module.exports = { load, save, DEFAULT_RULES };

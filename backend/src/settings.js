/* Impostazioni modificabili dalla console (data/settings.json), sopra i valori di .env.
   - support: la casella di raccolta (in prova può essere una casella personale, es. marrali@efuturelab.it)
   - graph: collegamento a Office 365 (Microsoft Graph) per leggere la posta in arrivo e i contatti di quella casella */
const fs = require("fs");
const path = require("path");
const cfg = require("./config");
const FILE = path.join(cfg.dataDir, "settings.json");

function load() { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return {}; } }
function save(s) { fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(s, null, 2)); }
const support = () => load().support || cfg.support;
function graph() {
  const g = load().graph || {};
  return {
    tenant: g.tenant || cfg.graph.tenant, clientId: g.clientId || cfg.graph.clientId, clientSecret: g.clientSecret || cfg.graph.clientSecret,
    mailbox: g.mailbox || support(),
    readMail: g.readMail !== false, readContacts: g.readContacts !== false, every: Number(g.every || 5),
  };
}
/* quello che vede la console: il segreto non torna mai indietro, si sa solo se c'è */
function publicView() {
  const g = graph();
  return { support: support(), graph: { tenant: g.tenant, clientId: g.clientId, secretSet: !!g.clientSecret, mailbox: (load().graph || {}).mailbox || "", reading: g.mailbox, readMail: g.readMail, readContacts: g.readContacts, every: g.every } };
}
const isMail = v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || ""));
function update(body) {
  const s = load(), g = s.graph || {};
  if (body.support !== undefined) { if (!isMail(body.support)) return { error: "casella di raccolta non valida" }; s.support = String(body.support).trim().toLowerCase(); }
  const b = body.graph || {};
  if (b.mailbox !== undefined) { if (b.mailbox && !isMail(b.mailbox)) return { error: "casella da leggere non valida" }; g.mailbox = String(b.mailbox || "").trim().toLowerCase(); }
  for (const k of ["tenant", "clientId"]) if (b[k] !== undefined) g[k] = String(b[k]).trim();
  if (b.clientSecret) g.clientSecret = String(b.clientSecret).trim();      /* vuoto = lascia quello salvato */
  if (b.clearSecret) delete g.clientSecret;
  for (const k of ["readMail", "readContacts"]) if (b[k] !== undefined) g[k] = !!b[k];
  if (b.every !== undefined) g.every = [1, 5, 15].includes(Number(b.every)) ? Number(b.every) : 5;
  s.graph = g; save(s);
  return { ok: true, settings: publicView() };
}
/* profili e permessi: per ogni area, v = vedere, m = creare/modificare, e = eliminare */
const AREE = ["cruscotto", "posta", "ticket", "clienti", "utenti", "profili", "tecnici", "office365", "collegamenti", "regole", "backup", "audit", "tutorial"];
const DEFAULT_PROFILES = {
  admin: { nome: "Amministratore", desc: "Tutto, compresa la configurazione", perm: Object.fromEntries(AREE.map(a => [a, "vme"])) },
  resp: { nome: "Responsabile service", desc: "Lavoro quotidiano, tecnici e regole; vede utenti e registro", perm: {
    cruscotto: "v", posta: "vm", ticket: "vme", clienti: "vme", utenti: "v", profili: "v", tecnici: "vme", office365: "", collegamenti: "v", regole: "vm", backup: "", audit: "v", tutorial: "v" } },
  op: { nome: "Tecnico", desc: "I suoi interventi, posta, ticket e clienti; nessuna configurazione", perm: {
    cruscotto: "v", posta: "", ticket: "vm", clienti: "v", utenti: "", profili: "", tecnici: "", office365: "", collegamenti: "", regole: "", backup: "", audit: "", tutorial: "v" } },
};
function profiles() {
  const saved = load().profiles || {};
  const out = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
  for (const k of ["resp", "op"]) if (saved[k]) for (const a of AREE) if (typeof saved[k][a] === "string") out[k].perm[a] = saved[k][a].replace(/[^vme]/g, "");
  return out;                                   /* l'amministratore ha sempre tutto */
}
function updateProfiles(body) {
  const s = load(); s.profiles = s.profiles || {};
  for (const k of ["resp", "op"]) if (body[k]) {
    s.profiles[k] = {};
    for (const a of AREE) { let v = String(body[k][a] || "").replace(/[^vme]/g, ""); if (v && !v.includes("v")) v = "v" + v; s.profiles[k][a] = v; }
  }
  save(s); return profiles();
}
const can = (profilo, area, right) => ((profiles()[profilo] || { perm: {} }).perm[area] || "").includes(right);
/* copia di sicurezza: tutto data/ tranne il segreto di Office 365 e i loghi */
function backupData() {
  const read = f => { try { return JSON.parse(fs.readFileSync(path.join(cfg.dataDir, f), "utf8")); } catch (e) { return null; } };
  const st = load(); if (st.graph) { st.graph = { ...st.graph }; delete st.graph.clientSecret; }
  return { app: "Ticket Farm", version: 1, created: new Date().toISOString(), files: { "settings.json": st, "users.json": read("users.json"), "tecnici.json": read("tecnici.json"), "state.json": read("state.json") } };
}
function restoreData(b) {
  if (!b || b.app !== "Ticket Farm" || !b.files) return { error: "file di backup non valido" };
  const keep = load();
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  for (const f of ["settings.json", "users.json", "tecnici.json", "state.json"]) {
    let v = b.files[f]; if (v == null) continue;
    if (f === "settings.json" && keep.graph && keep.graph.clientSecret) { v.graph = v.graph || {}; v.graph.clientSecret = keep.graph.clientSecret; }
    fs.writeFileSync(path.join(cfg.dataDir, f), JSON.stringify(v, null, 2));
  }
  return { ok: true, created: b.created };
}
module.exports = { support, graph, publicView, update, AREE, profiles, updateProfiles, can, backupData, restoreData };

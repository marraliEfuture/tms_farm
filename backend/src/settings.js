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
/* assistente AI: in prova è acceso di base (senza chiave risponde con un esempio); dal vivo si accende dalla console */
function ai() {
  const a = load().ai || {};
  return { enabled: !!a.enabled, apiKey: a.apiKey || "", model: a.model || "claude-opus-5-5",
    promemoria: a.promemoria !== false, priorita: a.priorita !== false };
}
function aiPublic() { const a = ai(); return { enabled: a.enabled, keySet: !!a.apiKey, envKey: !!process.env.ANTHROPIC_API_KEY, model: a.model, promemoria: a.promemoria, priorita: a.priorita }; }
function updateAi(b) {
  const s = load(), a = s.ai || {};
  if (b.enabled !== undefined) a.enabled = !!b.enabled;
  if (b.apiKey) { if (!/^sk-ant-[\w-]{10,}$/.test(String(b.apiKey).trim())) return { error: "la chiave API di Anthropic inizia con sk-ant-" }; a.apiKey = String(b.apiKey).trim(); }
  if (b.clearKey) delete a.apiKey;
  if (b.model !== undefined) { if (!["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"].includes(b.model)) return { error: "modello non valido" }; a.model = b.model; }
  for (const k of ["promemoria", "priorita"]) if (b[k] !== undefined) a[k] = !!b[k];
  s.ai = a; save(s); return { ok: true, ai: aiPublic() };
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
const AREE = ["cruscotto", "posta", "ticket", "clienti", "utenti", "profili", "tecnici", "aree", "recap", "office365", "ai", "collegamenti", "regole", "backup", "audit", "tutorial"];
const P = o => Object.fromEntries(AREE.map(a => [a, o[a] || ""]));
const DEFAULT_PROFILES = {
  admin: { nome: "Amministratore", desc: "Tutto, compresa la configurazione", base: true, perm: Object.fromEntries(AREE.map(a => [a, "vme"])) },
  resp: { nome: "Responsabile service", desc: "Lavoro quotidiano, tecnici, aree e regole; vede utenti e registro", base: true, perm: P({
    cruscotto: "v", posta: "vm", ticket: "vme", clienti: "vme", utenti: "v", profili: "v", tecnici: "vme", aree: "vme", recap: "vm", collegamenti: "v", regole: "vm", audit: "v", tutorial: "v" }) },
  agent: { nome: "Agente", desc: "Ufficio: ticket, messaggi, clienti e posta in arrivo delle sue aree di lavoro", base: true, perm: P({
    cruscotto: "v", posta: "vm", ticket: "vm", clienti: "vm", tecnici: "v", aree: "v", recap: "v", tutorial: "v" }) },
  op: { nome: "Tecnico", desc: "I suoi interventi, messaggi, ticket e clienti; nessuna configurazione", base: true, perm: P({
    cruscotto: "v", ticket: "vm", clienti: "v", tutorial: "v" }) },
  cliente: { nome: "Cliente", desc: "Solo i ticket della propria azienda: li vede e ne apre di nuovi", base: true, perm: P({ cruscotto: "v", ticket: "vm" }) },
};
const cleanPerm = v => { v = String(v || "").replace(/[^vme]/g, ""); if (v && !v.includes("v")) v = "v" + v; return [...new Set(v)].join(""); };
function profiles() {
  const saved = load().profiles || {};
  const out = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
  for (const [k, p] of Object.entries(saved.custom || {})) out[k] = { nome: p.nome, desc: p.desc || "", base: false, perm: P(p.perm || {}) };
  for (const k of Object.keys(out)) if (k !== "admin" && saved[k]) for (const a of AREE) if (typeof saved[k][a] === "string") out[k].perm[a] = saved[k][a].replace(/[^vme]/g, "");
  return out;                                   /* l'amministratore ha sempre tutto */
}
function updateProfiles(body) {
  const s = load(); s.profiles = s.profiles || {};
  for (const k of Object.keys(profiles())) if (k !== "admin" && body[k]) {
    s.profiles[k] = {};
    for (const a of AREE) s.profiles[k][a] = cleanPerm(body[k][a]);
  }
  save(s); return profiles();
}
/* profili creati dall'ufficio: si partono da uno esistente, si rinominano, si eliminano se nessuno li usa */
function addProfile({ nome, desc, base }) {
  nome = String(nome || "").trim().slice(0, 40);
  if (!nome) return { error: "dai un nome al profilo" };
  const all = profiles();
  if (Object.values(all).some(p => p.nome.toLowerCase() === nome.toLowerCase())) return { error: "esiste già un profilo con questo nome" };
  const key = "p_" + nome.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) + "_" + Date.now().toString(36).slice(-4);
  const from = all[base] && base !== "admin" ? all[base].perm : all.op.perm;
  const s = load(); s.profiles = s.profiles || {}; s.profiles.custom = s.profiles.custom || {};
  s.profiles.custom[key] = { nome, desc: String(desc || "").slice(0, 160), perm: { ...from } };
  save(s); return { ok: true, key, profiles: profiles() };
}
function editProfile(key, { nome, desc }) {
  const s = load(), c = ((s.profiles || {}).custom || {})[key];
  if (!c) return { error: DEFAULT_PROFILES[key] ? "i profili di base non si rinominano" : "profilo non trovato" };
  if (nome !== undefined) { nome = String(nome).trim().slice(0, 40); if (!nome) return { error: "dai un nome al profilo" }; c.nome = nome; }
  if (desc !== undefined) c.desc = String(desc).slice(0, 160);
  save(s); return { ok: true, profiles: profiles() };
}
function removeProfile(key, inUse) {
  const s = load(), custom = (s.profiles || {}).custom || {};
  if (!custom[key]) return { error: DEFAULT_PROFILES[key] ? "i profili di base non si eliminano" : "profilo non trovato" };
  if (inUse) return { error: "il profilo è assegnato ad almeno un utente: cambia prima il loro profilo" };
  delete custom[key]; delete s.profiles[key]; save(s); return { ok: true, profiles: profiles() };
}
/* aree di lavoro: si associano a tecnici e agenti; eliminate restano nello storico */
/* in prova, finché non se ne crea una, tre aree per settore di clienti (analisi di acqua e vapore) */
const DEMO_AREE = [
  { id: "a-ene", nome: "Centrali e teleriscaldamento", desc: "Ciclo acqua-vapore: silice, sodio, conducibilità, ossigeno", colore: "#2aa7ff" },
  { id: "a-acq", nome: "Acque potabili e reflue", desc: "Acquedotti e depuratori: cloro, torbidità, ammonio, fosfato", colore: "#22aa66" },
  { id: "a-pha", nome: "Farmaceutico e acqua ultrapura", desc: "Acqua purificata e per iniettabili, semiconduttori: TOC, conducibilità", colore: "#d9ab45" },
];
function aree() { const s = load(); return (s.aree || (cfg.mode === "demo" ? DEMO_AREE : [])).map(a => ({ attivo: true, ...a })); }
function addArea({ nome, desc, colore }) {
  nome = String(nome || "").trim().slice(0, 50);
  if (!nome) return { error: "dai un nome all'area" };
  const s = load(); s.aree = s.aree || (cfg.mode === "demo" ? JSON.parse(JSON.stringify(DEMO_AREE)) : []);
  if (s.aree.some(a => !a.eliminato && a.nome.toLowerCase() === nome.toLowerCase())) return { error: "esiste già un'area con questo nome" };
  const a = { id: "a" + Date.now().toString(36), nome, desc: String(desc || "").slice(0, 200), colore: /^#[0-9a-f]{6}$/i.test(colore || "") ? colore : "#2aa7ff", attivo: true };
  s.aree.push(a); save(s); return { ok: true, area: a };
}
function editArea(id, { nome, desc, colore, attivo }) {
  const s = load(); if (!s.aree && cfg.mode === "demo") s.aree = JSON.parse(JSON.stringify(DEMO_AREE)); const a = s.aree.find(x => x.id === id && !x.eliminato);
  if (!a) return { error: "area non trovata" };
  if (nome !== undefined) { nome = String(nome).trim().slice(0, 50); if (!nome) return { error: "dai un nome all'area" }; a.nome = nome; }
  if (desc !== undefined) a.desc = String(desc).slice(0, 200);
  if (colore !== undefined && /^#[0-9a-f]{6}$/i.test(colore)) a.colore = colore;
  if (attivo !== undefined) a.attivo = !!attivo;
  save(s); return { ok: true, area: a };
}
function removeArea(id) {
  const s = load(); if (!s.aree && cfg.mode === "demo") s.aree = JSON.parse(JSON.stringify(DEMO_AREE)); const a = s.aree.find(x => x.id === id && !x.eliminato);
  if (!a) return { error: "area non trovata" };
  a.eliminato = new Date().toISOString(); a.attivo = false; save(s); return { ok: true };
}
/* sistema dei ticket collegato: uno solo alla volta (ITSM oppure Halo) */
const SISTEMI = ["ITSM", "Halo"];
function sistema() { const v = load().sistema; return SISTEMI.includes(v) ? v : "ITSM"; }
function setSistema(v) { if (!SISTEMI.includes(v)) return { error: "sistema non valido" }; const s = load(); s.sistema = v; save(s); return { ok: true, sistema: v }; }
/* recap ai clienti: mail al contatto del ticket a ogni passaggio importante e riepilogo settimanale */
const RECAP_DEF = { attivo: true, apertura: true, intervento: true, chiusura: true, settimanale: true, giorno: 1, ora: 8, conferma: true };
function recap() { return { ...RECAP_DEF, ...(load().recap || {}) }; }
function updateRecap(b) {
  const r = recap();
  for (const k of ["attivo", "apertura", "intervento", "chiusura", "settimanale", "conferma"]) if (b[k] !== undefined) r[k] = !!b[k];
  if (b.giorno !== undefined) r.giorno = Math.max(0, Math.min(6, Math.floor(Number(b.giorno) || 0)));
  if (b.ora !== undefined) r.ora = Math.max(0, Math.min(23, Math.floor(Number(b.ora) || 0)));
  const s = load(); s.recap = r; save(s); return { ok: true, recap: r };
}
/* limite di utenti attivi (console + tecnici dell'app); 0 = nessun limite */
function limiti() { const l = load().limiti || {}; return { maxUtenti: Number(l.maxUtenti) > 0 ? Math.floor(Number(l.maxUtenti)) : 0 }; }
function updateLimiti({ maxUtenti }) {
  const n = Math.floor(Number(maxUtenti));
  if (!(n >= 0) || n > 100000) return { error: "numero non valido" };
  const s = load(); s.limiti = { maxUtenti: n }; save(s); return { ok: true, limiti: limiti() };
}
const can = (profilo, area, right) => ((profiles()[profilo] || { perm: {} }).perm[area] || "").includes(right);
/* copia di sicurezza: tutto data/ tranne il segreto di Office 365 e i loghi */
function backupData() {
  const read = f => { try { return JSON.parse(fs.readFileSync(path.join(cfg.dataDir, f), "utf8")); } catch (e) { return null; } };
  const st = load(); if (st.graph) { st.graph = { ...st.graph }; delete st.graph.clientSecret; } if (st.ai) { st.ai = { ...st.ai }; delete st.ai.apiKey; }
  return { app: "Ticket Farm", version: 1, created: new Date().toISOString(), files: { "settings.json": st, "users.json": read("users.json"), "tecnici.json": read("tecnici.json"), "state.json": read("state.json") } };
}
function restoreData(b) {
  if (!b || b.app !== "Ticket Farm" || !b.files) return { error: "file di backup non valido" };
  const keep = load();
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  for (const f of ["settings.json", "users.json", "tecnici.json", "state.json"]) {
    let v = b.files[f]; if (v == null) continue;
    if (f === "settings.json" && keep.graph && keep.graph.clientSecret) { v.graph = v.graph || {}; v.graph.clientSecret = keep.graph.clientSecret; }
    if (f === "settings.json" && keep.ai && keep.ai.apiKey) { v.ai = v.ai || {}; v.ai.apiKey = keep.ai.apiKey; }
    fs.writeFileSync(path.join(cfg.dataDir, f), JSON.stringify(v, null, 2));
  }
  return { ok: true, created: b.created };
}
module.exports = { ai, aiPublic, updateAi, support, graph, publicView, update, AREE, profiles, updateProfiles, addProfile, editProfile, removeProfile, aree, addArea, editArea, removeArea, limiti, updateLimiti, recap, updateRecap, sistema, setSistema, SISTEMI, can, backupData, restoreData };

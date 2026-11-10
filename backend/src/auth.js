/* Accesso dei tecnici: mail + codice. I codici sono salvati solo come impronta (scrypt). */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const cfg = require("./config");

const TECH_FILE = path.join(cfg.dataDir, "tecnici.json");
const DEMO_TECHS = [
  { mail: "mb@efuture.it", nome: "Tecnico Zona Sud", ini: "MB", zona: "Sud", codice: "123456" },
  { mail: "lc@efuture.it", nome: "Tecnico Zona Centro", ini: "LC", zona: "Centro", codice: "123456" },
];

function hashCode(mail, code) { return crypto.scryptSync(String(code), String(mail).toLowerCase(), 32).toString("hex"); }

function techs() {
  if (fs.existsSync(TECH_FILE)) return JSON.parse(fs.readFileSync(TECH_FILE, "utf8"));
  if (cfg.mode === "demo") return DEMO_TECHS.map(t => ({ ...t, hash: hashCode(t.mail, t.codice) }));
  return [];
}
function findTech(mail) { return techs().find(t => t.mail.toLowerCase() === String(mail || "").toLowerCase()); }

function login(mail, code) {
  const t = findTech(mail);
  if (!t) return null;
  const a = Buffer.from(hashCode(t.mail, code), "hex"), b = Buffer.from(t.hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return sign({ mail: t.mail, exp: Date.now() + 1000 * 60 * 60 * 24 * 90 });
}
function sign(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString("base64url");
  return body + "." + crypto.createHmac("sha256", cfg.secret).update(body).digest("base64url");
}
function verify(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const good = crypto.createHmac("sha256", cfg.secret).update(body).digest("base64url");
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const obj = JSON.parse(Buffer.from(body, "base64url").toString());
  if (obj.exp < Date.now()) return null;
  return findTech(obj.mail) || null;
}
/* middleware per le API dell'app */
function requireTech(req, res, next) {
  const t = verify((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  if (!t) return res.status(401).json({ error: "accesso richiesto" });
  req.tech = t; next();
}
/* ---- console dell'ufficio: accesso con utente e password, profilo modificabile ----
   Il profilo è in data/admin.json; finché non esiste si usano ADMIN_USER e ADMIN_PASSWORD di .env.
   In prova senza password in .env: utente "admin", password "admin123" (suggerita nella schermata di accesso). */
const ADMIN_FILE = path.join(cfg.dataDir, "admin.json");
const DEMO_ADMIN = { user: "admin", password: "admin123" };
function adminAccount() {
  if (fs.existsSync(ADMIN_FILE)) return JSON.parse(fs.readFileSync(ADMIN_FILE, "utf8"));
  if (cfg.adminPassword) return { user: cfg.adminUser, nome: "Amministratore", mail: cfg.support, hash: hashCode(cfg.adminUser, cfg.adminPassword) };
  if (cfg.mode === "demo") return { user: DEMO_ADMIN.user, nome: "Amministratore", mail: cfg.support, hash: hashCode(DEMO_ADMIN.user, DEMO_ADMIN.password) };
  return null;
}
function adminDemoHint() { return cfg.mode === "demo" && !cfg.adminPassword && !fs.existsSync(ADMIN_FILE) ? DEMO_ADMIN : null; }
function checkPassword(acc, user, password) {
  if (!acc || String(user || "").toLowerCase() !== acc.user.toLowerCase()) return false;
  const a = Buffer.from(hashCode(acc.user, password || ""), "hex"), b = Buffer.from(acc.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function adminLogin(user, password) {
  const acc = adminAccount();
  if (!checkPassword(acc, user, password)) return null;
  return sign({ role: "admin", user: acc.user, exp: Date.now() + 1000 * 60 * 60 * 12 });
}
function verifyAdmin(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const good = crypto.createHmac("sha256", cfg.secret).update(body).digest("base64url");
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const obj = JSON.parse(Buffer.from(body, "base64url").toString());
  const acc = adminAccount();
  if (obj.role !== "admin" || obj.exp < Date.now() || !acc || obj.user !== acc.user) return null;
  return acc;
}
/* aggiorna nome, mail e (se data) la password; la password attuale è sempre richiesta */
function updateAdmin({ nome, mail, attuale, nuova }) {
  const acc = adminAccount();
  if (!checkPassword(acc, acc && acc.user, attuale)) return { error: "password attuale non corretta" };
  if (nuova && String(nuova).length < 8) return { error: "la nuova password deve avere almeno 8 caratteri" };
  const next = { user: acc.user, nome: String(nome || acc.nome || "").slice(0, 80), mail: String(mail || acc.mail || "").slice(0, 120),
    hash: nuova ? hashCode(acc.user, nuova) : acc.hash };
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(next, null, 2));
  return { ok: true, me: publicAdmin(next) };
}
const publicAdmin = a => a ? { user: a.user, nome: a.nome || "", mail: a.mail || "" } : null;
function requireAdmin(req, res, next) {
  const acc = verifyAdmin((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  if (!acc) return res.status(401).json({ error: "accesso richiesto" });
  req.admin = acc; next();
}
/* ---- gestione dei tecnici dalla console: data/tecnici.json (in prova parte dai tecnici di esempio) ---- */
function saveTechs(list) { fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(TECH_FILE, JSON.stringify(list.map(({ codice, ...t }) => t), null, 2)); }
const newCode = () => String(crypto.randomInt(100000, 1000000));
function addTech({ mail, nome, ini, zona }) {
  mail = String(mail || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail) || !nome) return { error: "nome e mail aziendale obbligatori" };
  const list = techs();
  if (list.some(t => t.mail.toLowerCase() === mail)) return { error: "esiste già un tecnico con questa mail" };
  const code = newCode(), t = { mail, nome: String(nome).slice(0, 80), ini: String(ini || "").slice(0, 3).toUpperCase(), zona: String(zona || "").slice(0, 40), hash: hashCode(mail, code) };
  list.push(t); saveTechs(list);
  return { tech: { mail, nome: t.nome, ini: t.ini, zona: t.zona }, code };
}
function editTech(mail, { nome, ini, zona, newCode: regen }) {
  const list = techs(), t = list.find(x => x.mail.toLowerCase() === String(mail).toLowerCase());
  if (!t) return { error: "tecnico non trovato" };
  if (nome) t.nome = String(nome).slice(0, 80);
  if (ini !== undefined) t.ini = String(ini).slice(0, 3).toUpperCase();
  if (zona !== undefined) t.zona = String(zona).slice(0, 40);
  let code;
  if (regen) { code = newCode(); t.hash = hashCode(t.mail, code); }
  saveTechs(list);
  return { tech: { mail: t.mail, nome: t.nome, ini: t.ini, zona: t.zona }, code };
}
function removeTech(mail) {
  const list = techs(), i = list.findIndex(x => x.mail.toLowerCase() === String(mail).toLowerCase());
  if (i < 0) return false;
  list.splice(i, 1); saveTechs(list); return true;
}
/* solo in prova, senza tecnici veri: credenziali da suggerire nella schermata di accesso */
function demoHint() {
  if (cfg.mode !== "demo") return null;
  const t = findTech(DEMO_TECHS[0].mail);
  return t && t.hash === hashCode(DEMO_TECHS[0].mail, DEMO_TECHS[0].codice) ? { mail: DEMO_TECHS[0].mail, code: DEMO_TECHS[0].codice } : null;
}
module.exports = { addTech, editTech, removeTech, adminLogin, adminDemoHint, adminAccount, updateAdmin, publicAdmin, demoHint, hashCode, techs, findTech, login, verify, requireTech, requireAdmin, TECH_FILE };

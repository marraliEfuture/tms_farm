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
/* ---- console dell'ufficio: utenti con profilo (admin, resp, op) in data/users.json ----
   Finché il file non esiste: l'utente di .env (ADMIN_USER/ADMIN_PASSWORD) o, in prova, admin/admin123
   più due utenti di esempio (responsabile e operatore, stessa password di prova). */
const USERS_FILE = path.join(cfg.dataDir, "users.json");
const OLD_ADMIN_FILE = path.join(cfg.dataDir, "admin.json");
const DEMO_ADMIN = { user: "admin", password: "admin123" };
const PROFILI = ["admin", "resp", "op"];
function users() {
  if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  const list = [];
  if (fs.existsSync(OLD_ADMIN_FILE)) list.push({ ...JSON.parse(fs.readFileSync(OLD_ADMIN_FILE, "utf8")), profilo: "admin", attivo: true });
  else if (cfg.adminPassword) list.push({ user: cfg.adminUser, nome: "Amministratore", mail: cfg.support, profilo: "admin", attivo: true, hash: hashCode(cfg.adminUser, cfg.adminPassword) });
  else if (cfg.mode === "demo") list.push({ user: DEMO_ADMIN.user, nome: "Amministratore", mail: cfg.support, profilo: "admin", attivo: true, hash: hashCode(DEMO_ADMIN.user, DEMO_ADMIN.password) });
  if (cfg.mode === "demo" && !cfg.adminPassword) {
    list.push({ user: "l.bianchi", nome: "Laura Bianchi", mail: "l.bianchi@efuture.it", profilo: "resp", attivo: true, hash: hashCode("l.bianchi", DEMO_ADMIN.password) });
    list.push({ user: "g.verdi", nome: "Giulia Verdi", mail: "g.verdi@efuture.it", profilo: "op", attivo: true, hash: hashCode("g.verdi", DEMO_ADMIN.password) });
  }
  return list;
}
function saveUsers(list) { fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2)); }
const findUser = u => users().find(x => x.user.toLowerCase() === String(u || "").toLowerCase());
function adminAccount() { return users().find(u => u.profilo === "admin" && u.attivo !== false) || null; }
function adminDemoHint() {
  if (cfg.mode !== "demo" || cfg.adminPassword) return null;
  const a = findUser(DEMO_ADMIN.user);
  return a && a.hash === hashCode(DEMO_ADMIN.user, DEMO_ADMIN.password) ? DEMO_ADMIN : null;
}
function checkPassword(acc, password) {
  if (!acc || !acc.hash) return false;
  const a = Buffer.from(hashCode(acc.user, password || ""), "hex"), b = Buffer.from(acc.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function adminLogin(user, password) {
  const acc = findUser(user);
  if (!acc || acc.attivo === false || !checkPassword(acc, password)) return null;
  const list = users(), me = list.find(x => x.user === acc.user); me.ultimo = new Date().toISOString(); saveUsers(list);
  return sign({ role: "admin", user: acc.user, exp: Date.now() + 1000 * 60 * 60 * 12 });
}
function verifyAdmin(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const good = crypto.createHmac("sha256", cfg.secret).update(body).digest("base64url");
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const obj = JSON.parse(Buffer.from(body, "base64url").toString());
  const acc = findUser(obj.user);
  if (obj.role !== "admin" || obj.exp < Date.now() || !acc || acc.attivo === false) return null;
  return acc;
}
/* il proprio profilo: nome, mail e (se data) la password; la password attuale è sempre richiesta */
const HOMES = ["cruscotto", "ticket", "clienti", "posta", "utenti", "profili", "tecnici", "office365", "ai", "regole", "collegamenti", "backup", "audit", "tutorial"];
function updateAdmin({ nome, mail, attuale, nuova, home, vista }, who) {
  const list = users(), acc = list.find(x => x.user === (who || {}).user);
  if (!acc) return { error: "utente non trovato" };
  /* schermata iniziale e vista: preferenze personali, non serve la password */
  if (home !== undefined && HOMES.includes(home)) acc.home = home;
  if (vista !== undefined && PROFILI.includes(vista)) acc.vista = vista;
  if (!nuova && nome === undefined && mail === undefined) { saveUsers(list); return { ok: true, me: publicAdmin(acc) }; }
  if (!checkPassword(acc, attuale)) return { error: "password attuale non corretta" };
  if (nuova && String(nuova).length < 8) return { error: "la nuova password deve avere almeno 8 caratteri" };
  acc.nome = String(nome || acc.nome || "").slice(0, 80); acc.mail = String(mail || acc.mail || "").slice(0, 120);
  if (nuova) acc.hash = hashCode(acc.user, nuova);
  saveUsers(list);
  return { ok: true, me: publicAdmin(acc) };
}
const publicAdmin = a => a ? { user: a.user, nome: a.nome || "", mail: a.mail || "", profilo: a.profilo || "admin", attivo: a.attivo !== false, ultimo: a.ultimo || "", home: a.home || "cruscotto", vista: a.vista || "op" } : null;
/* gestione utenti dalla console */
function addUser({ user, nome, mail, profilo, password }) {
  user = String(user || "").trim().toLowerCase();
  if (!/^[a-z0-9._@-]{3,60}$/.test(user)) return { error: "nome utente non valido (lettere, numeri, punto, trattino)" };
  if (!PROFILI.includes(profilo)) return { error: "profilo non valido" };
  if (String(password || "").length < 8) return { error: "la password deve avere almeno 8 caratteri" };
  const list = users();
  if (list.some(x => x.user === user)) return { error: "esiste già un utente con questo nome" };
  const u = { user, nome: String(nome || user).slice(0, 80), mail: String(mail || "").slice(0, 120), profilo, attivo: true, hash: hashCode(user, password) };
  list.push(u); saveUsers(list); return { ok: true, user: publicAdmin(u) };
}
function editUser(user, { nome, mail, profilo, attivo, password }, who) {
  const list = users(), u = list.find(x => x.user === user);
  if (!u) return { error: "utente non trovato" };
  const admins = list.filter(x => x.profilo === "admin" && x.attivo !== false);
  const losesAdmin = (profilo && profilo !== "admin") || attivo === false;
  if (u.profilo === "admin" && losesAdmin && admins.length <= 1) return { error: "serve almeno un amministratore attivo" };
  if (who && who.user === user && attivo === false) return { error: "non puoi disattivare te stesso" };
  if (nome !== undefined) u.nome = String(nome).slice(0, 80);
  if (mail !== undefined) u.mail = String(mail).slice(0, 120);
  if (profilo !== undefined) { if (!PROFILI.includes(profilo)) return { error: "profilo non valido" }; u.profilo = profilo; }
  if (attivo !== undefined) u.attivo = !!attivo;
  if (password) { if (String(password).length < 8) return { error: "la password deve avere almeno 8 caratteri" }; u.hash = hashCode(u.user, password); }
  saveUsers(list); return { ok: true, user: publicAdmin(u) };
}
function removeUser(user, who) {
  const list = users(), i = list.findIndex(x => x.user === user);
  if (i < 0) return { error: "utente non trovato" };
  if (who && who.user === user) return { error: "non puoi eliminare te stesso" };
  if (list[i].profilo === "admin" && list.filter(x => x.profilo === "admin" && x.attivo !== false).length <= 1) return { error: "serve almeno un amministratore attivo" };
  list.splice(i, 1); saveUsers(list); return { ok: true };
}
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
module.exports = { users, saveUsers, findUser, addUser, editUser, removeUser, PROFILI, USERS_FILE, addTech, editTech, removeTech, adminLogin, adminDemoHint, adminAccount, updateAdmin, publicAdmin, demoHint, hashCode, techs, findTech, login, verify, requireTech, requireAdmin, TECH_FILE };

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
function sessionFor(acc) {
  const list = users(), me = list.find(x => x.user === acc.user); me.ultimo = new Date().toISOString(); saveUsers(list);
  return sign({ role: "admin", user: acc.user, exp: Date.now() + 1000 * 60 * 60 * 12 });
}
/* password giusta: se l'utente ha la verifica in due passaggi riceve un «biglietto» di 5 minuti per il codice */
function adminLogin(user, password) {
  const acc = findUser(user);
  if (!acc || acc.attivo === false || !checkPassword(acc, password)) return null;
  if (acc.totp) return { need2fa: true, ticket: sign({ role: "2fa", user: acc.user, exp: Date.now() + 5 * 60000 }) };
  return { token: sessionFor(acc) };
}
function readSigned(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const good = crypto.createHmac("sha256", cfg.secret).update(body).digest("base64url");
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const o = JSON.parse(Buffer.from(body, "base64url").toString());
  return o.exp < Date.now() ? null : o;
}
const totp = require("./totp");
const hashRec = c => crypto.createHash("sha256").update(cfg.secret + "|" + String(c).replace(/[^a-z0-9]/gi, "").toLowerCase()).digest("hex");
/* secondo passaggio: codice dell'app di autenticazione oppure un codice di recupero (usa e getta) */
function adminLogin2fa(ticket, input) {
  const o = readSigned(ticket); if (!o || o.role !== "2fa") return { error: "tempo scaduto: accedi di nuovo" };
  const list = users(), acc = list.find(x => x.user === o.user);
  if (!acc || acc.attivo === false || !acc.totp) return { error: "accedi di nuovo" };
  if (totp.verify(acc.totp, input)) return { token: sessionFor(acc), acc };
  const h = hashRec(input), i = (acc.recovery || []).indexOf(h);
  if (i >= 0) { acc.recovery.splice(i, 1); saveUsers(list); return { token: sessionFor(acc), acc, usedRecovery: true, left: acc.recovery.length }; }
  return { error: "codice non corretto" };
}
function setup2fa(who) {
  const list = users(), acc = list.find(x => x.user === who.user);
  acc.totpPending = totp.newSecret(); saveUsers(list);
  return { secret: acc.totpPending, uri: totp.uri(acc.totpPending, acc.user) };
}
function enable2fa(who, input) {
  const list = users(), acc = list.find(x => x.user === who.user);
  if (!acc.totpPending || !totp.verify(acc.totpPending, input)) return { error: "codice non corretto: controlla l'ora del telefono e riprova" };
  acc.totp = acc.totpPending; delete acc.totpPending;
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString("hex").replace(/(.{5})/, "$1-"));
  acc.recovery = codes.map(hashRec); saveUsers(list);
  return { ok: true, recovery: codes };
}
function disable2fa(who, password, input) {
  const list = users(), acc = list.find(x => x.user === who.user);
  if (!checkPassword(acc, password)) return { error: "password non corretta" };
  if (!acc.totp || !totp.verify(acc.totp, input)) return { error: "codice non corretto" };
  delete acc.totp; delete acc.recovery; saveUsers(list); return { ok: true };
}
/* recupero password: link valido 30 minuti, usa e getta; la risposta non dice mai se l'utente esiste */
function forgot(userOrMail) {
  const k = String(userOrMail || "").trim().toLowerCase(); if (!k) return null;
  const list = users(), acc = list.find(x => x.attivo !== false && (x.user === k || (x.mail || "").toLowerCase() === k));
  if (!acc || !acc.mail) return null;
  const token = crypto.randomBytes(24).toString("base64url");
  acc.resetHash = crypto.createHash("sha256").update(token).digest("hex"); acc.resetExp = Date.now() + 30 * 60000; saveUsers(list);
  return { acc, token };
}
function resetPassword(token, password) {
  if (String(password || "").length < 8) return { error: "la password deve avere almeno 8 caratteri" };
  const h = crypto.createHash("sha256").update(String(token || "")).digest("hex");
  const list = users(), acc = list.find(x => x.resetHash && x.resetHash === h);
  if (!acc || acc.resetExp < Date.now()) return { error: "link scaduto o già usato: chiedine uno nuovo" };
  acc.hash = hashCode(acc.user, password); delete acc.resetHash; delete acc.resetExp; saveUsers(list);
  return { ok: true, user: acc.user };
}
function verifyAdmin(token) {
  const obj = readSigned(token); if (!obj) return null;
  const acc = findUser(obj.user);
  if (obj.role !== "admin" || !acc || acc.attivo === false) return null;
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
const publicAdmin = a => a ? { user: a.user, nome: a.nome || "", mail: a.mail || "", profilo: a.profilo || "admin", attivo: a.attivo !== false, ultimo: a.ultimo || "", home: a.home || "cruscotto", vista: a.vista || "op",
  twofa: !!a.totp, recoveryLeft: (a.recovery || []).length, passkeys: (a.passkeys || []).map(p => ({ id: p.id, nome: p.nome, creato: p.creato, usato: p.usato || "" })) } : null;
/* passkey: credenziali salvate sull'utente */
function addPasskey(who, cred) { const list = users(), acc = list.find(x => x.user === who.user); acc.passkeys = acc.passkeys || []; acc.passkeys.push(cred); delete acc.pkChallenge; saveUsers(list); }
function setPkChallenge(who, ch) { const list = users(), acc = list.find(x => x.user === who.user); acc.pkChallenge = ch; saveUsers(list); }
function findByPasskey(id) { return users().find(u => (u.passkeys || []).some(p => p.id === id)); }
function touchPasskey(user, id, counter) { const list = users(), acc = list.find(x => x.user === user), p = acc.passkeys.find(x => x.id === id); p.counter = counter; p.usato = new Date().toISOString(); saveUsers(list); }
function removePasskey(who, id) { const list = users(), acc = list.find(x => x.user === who.user); const n = (acc.passkeys || []).length; acc.passkeys = (acc.passkeys || []).filter(p => p.id !== id); saveUsers(list); return n !== acc.passkeys.length; }
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
module.exports = { sessionFor, readSigned, adminLogin2fa, setup2fa, enable2fa, disable2fa, forgot, resetPassword, addPasskey, setPkChallenge, findByPasskey, touchPasskey, removePasskey, users, saveUsers, findUser, addUser, editUser, removeUser, PROFILI, USERS_FILE, addTech, editTech, removeTech, adminLogin, adminDemoHint, adminAccount, updateAdmin, publicAdmin, demoHint, hashCode, techs, findTech, login, verify, requireTech, requireAdmin, TECH_FILE };

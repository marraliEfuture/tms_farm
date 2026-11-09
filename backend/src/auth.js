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
/* middleware per la console: accesso con utente e password (Basic) */
function requireAdmin(req, res, next) {
  if (!cfg.adminPassword && cfg.mode === "demo") return next();
  const [u, p] = Buffer.from((req.headers.authorization || "").replace(/^Basic\s+/i, ""), "base64").toString().split(":");
  if (cfg.adminPassword && u === cfg.adminUser && p === cfg.adminPassword) return next();
  res.set("WWW-Authenticate", 'Basic realm="Ticket Farm"').status(401).send("Accesso richiesto");
}
/* solo in prova, senza tecnici veri: credenziali da suggerire nella schermata di accesso */
function demoHint() { return cfg.mode === "demo" && !fs.existsSync(TECH_FILE) ? { mail: DEMO_TECHS[0].mail, code: DEMO_TECHS[0].codice } : null; }
module.exports = { demoHint, hashCode, techs, findTech, login, verify, requireTech, requireAdmin, TECH_FILE };

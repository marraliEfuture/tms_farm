/* Notifiche push sul telefono dei tecnici (Web Push con chiavi VAPID, nessun servizio esterno da configurare).
   Le chiavi si creano la prima volta e restano in data/vapid.json; le iscrizioni dei telefoni in data/push.json. */
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");
const cfg = require("./config");

const KEYS = () => path.join(cfg.dataDir, "vapid.json");
const SUBS = () => path.join(cfg.dataDir, "push.json");
let ready = false;
function keys() {
  if (!fs.existsSync(KEYS())) { fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(KEYS(), JSON.stringify(webpush.generateVAPIDKeys(), null, 2)); }
  const k = JSON.parse(fs.readFileSync(KEYS(), "utf8"));
  if (!ready) { webpush.setVapidDetails("mailto:" + (process.env.SUPPORT_MAIL || "support@example.com"), k.publicKey, k.privateKey); ready = true; }
  return k;
}
const subs = () => fs.existsSync(SUBS()) ? JSON.parse(fs.readFileSync(SUBS(), "utf8")) : {};
const saveSubs = s => { fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(SUBS(), JSON.stringify(s, null, 2)); };

function publicKey() { return keys().publicKey; }
function subscribe(mail, sub) {
  if (!sub || !/^https:\/\//.test(String(sub.endpoint || "")) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return { error: "iscrizione non valida" };
  const s = subs(), list = (s[mail] = (s[mail] || []).filter(x => x.endpoint !== sub.endpoint));
  list.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, at: new Date().toISOString() });
  s[mail] = list.slice(-5); saveSubs(s); return { ok: true };
}
function unsubscribe(mail, endpoint) { const s = subs(); s[mail] = (s[mail] || []).filter(x => !endpoint || x.endpoint !== endpoint); saveSubs(s); return { ok: true }; }
function count(mail) { return (subs()[mail] || []).length; }

/* manda a tutti i telefoni del tecnico; le iscrizioni scadute (404/410) si tolgono da sole */
let sender = (sub, body) => webpush.sendNotification(sub, body, { TTL: 24 * 3600, urgency: "high" });
async function notify(mail, payload) {
  const list = subs()[mail] || []; if (!list.length) return 0;
  keys();
  let sent = 0; const dead = [];
  for (const sub of list) {
    try { await sender(sub, JSON.stringify(payload)); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(sub.endpoint); }
  }
  if (dead.length) { const s = subs(); s[mail] = (s[mail] || []).filter(x => !dead.includes(x.endpoint)); saveSubs(s); }
  return sent;
}
module.exports = { publicKey, subscribe, unsubscribe, notify, count, setSender: f => { sender = f; } };

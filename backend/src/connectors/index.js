/* Unisce le fonti: in prova i dati di esempio, dal vivo ITSM + Halo + contatti di Office 365. */
const cfg = require("../config");
const demo = require("./demo");
const itsm = require("./itsm");
const halo = require("./halo");
const graph = require("./graph");

let cache = null, cacheAt = 0, lastSync = null, lastErrors = {};
async function loadLive() {
  const safe = async (name, fn) => { try { const v = await fn(); delete lastErrors[name]; return v; } catch (e) { lastErrors[name] = e.message; return []; } };
  const [ic, hc, it, ht, gc] = await Promise.all([
    safe("ITSM", () => itsm.clients()), safe("Halo", () => halo.clients()),
    safe("ITSM", () => itsm.tickets()), safe("Halo", () => halo.tickets()), safe("Office 365", () => graph.contacts()),
  ]);
  const clients = [...ic, ...hc];
  for (const k of gc) {
    const c = clients.find(c => c.dom && c.dom === k.dom) || clients.find(c => k.company && c.name.toLowerCase() === k.company.toLowerCase());
    if (c && !c.contacts.some(x => x.mail && x.mail.toLowerCase() === k.mail.toLowerCase())) c.contacts.push({ n: k.n, src: "O365", mail: k.mail, tel: k.tel });
  }
  lastSync = new Date();
  return { clients, tickets: [...it, ...ht] };
}
async function data() {
  if (cfg.mode === "demo") return { clients: await demo.clients(), tickets: await demo.tickets() };
  if (!cache || Date.now() - cacheAt > 60000) { cache = await loadLive(); cacheAt = Date.now(); }
  return cache;
}
async function status() {
  if (cfg.mode === "demo") return demo.status();
  const when = lastSync ? lastSync.toLocaleTimeString("it-CH", { hour: "2-digit", minute: "2-digit" }) : "mai";
  const row = (n, how, what, conf) => ({ n, how, what, sync: conf ? (lastErrors[n] ? "errore: " + lastErrors[n] : when) : "non configurato", ok: conf && !lastErrors[n] });
  return [
    row("ITSM", "API di itsm.efuture.it", "Ticket, clienti, identificativi delle mail inviate", itsm.configured()),
    row("Halo", "API REST di Halo", "Ticket, clienti, contatti", halo.configured()),
    row("Office 365", "Microsoft Graph", "Contatti della casella " + cfg.graph.mailbox, graph.configured()),
  ];
}
function invalidate() { cache = null; }
module.exports = { data, status, invalidate, demo };

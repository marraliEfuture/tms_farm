/* Riconoscimento di una mail arrivata a support@: prova le regole in ordine.
   Restituisce { state: "ok"|"new"|"warn", ticket, client, how: [...] }. */
const TICKET_RE = /(Tck\s*#\d+|HALO-\d+)/i;

function domainOf(addr) { const m = /@([\w.-]+)/.exec(addr || ""); return m ? m[1].toLowerCase() : ""; }

function recognize(mail, ctx) {
  const { techs = [], clients = [], tickets = [], rules = [] } = ctx;
  /* un fornitore che scrive non apre ticket a suo nome: si riconoscono solo le aziende clienti */
  const clienti = clients.filter(c => c.tipo !== "fornitore");
  const on = k => (rules.find(r => r.k === k) || { on: true }).on;
  const h = name => { const x = (mail.headers || []).find(([k]) => k.toLowerCase() === name.toLowerCase()); return x ? x[1] : ""; };
  const how = [];
  let ticket = "", client = "";
  if (techs.some(t => t.mail.toLowerCase() === String(mail.from).toLowerCase())) how.push("tech");

  const ref = (h("In-Reply-To") + " " + h("References")).trim();
  if (on("reply") && ref) {
    const t = tickets.find(t => t.msgIds && t.msgIds.some(id => ref.includes(id)));
    if (t) { ticket = t.id; client = t.client; how.push("reply"); }
  }
  const sm = TICKET_RE.exec(mail.subject || "");
  if (on("subj") && sm) {
    const id = sm[1].replace(/\s+/g, " ");
    const t = tickets.find(t => t.id.toLowerCase().replace(/\s+/g, " ") === id.toLowerCase());
    if (t) { ticket = ticket || t.id; client = client || t.client; how.push("subj"); }
  }
  const hc = h("X-TicketFarm-Cliente-Id") || h("X-TicketFarm-Cliente");
  if (on("hdr") && hc && hc !== "da identificare") {
    const c = clienti.find(c => c.id === hc || c.name === hc);
    if (c) { client = client || c.id; how.push("hdr"); }
  }
  if (!client && on("from")) {
    const c = clienti.find(c => (c.contacts || []).some(k => (k.mail || "").toLowerCase() === String(mail.from).toLowerCase()));
    if (c) { client = c.id; how.push("from"); }
  }
  if (!client && on("dom")) {
    const d = domainOf(mail.from);
    const c = d && clienti.find(c => c.dom === d);
    if (c) { client = c.id; how.push("dom"); }
  }
  /* regole aggiunte dall'ufficio: dominio → cliente, parola nell'oggetto → cliente */
  if (!client) for (const r of (ctx.custom || []).filter(x => x.on !== false && !x.eliminato)) {
    const hit = r.tipo === "dominio" ? domainOf(mail.from) === String(r.valore).toLowerCase().replace(/^@/, "")
      : String(mail.subject || "").toLowerCase().includes(String(r.valore).toLowerCase());
    if (hit && clienti.some(c => c.id === r.cliente)) { client = r.cliente; how.push("custom"); break; }
  }
  const state = ticket ? "ok" : client ? "new" : "warn";
  /* la persona che scrive, se è un contatto noto */
  let contatto = "";
  for (const c of clients) { const k = (c.contacts || []).find(x => x.id && (x.mail || "").toLowerCase() === String(mail.from || "").toLowerCase()); if (k) { contatto = k.id; break; } }
  return { state, ticket, client, how, contatto };
}
module.exports = { recognize, domainOf, TICKET_RE };

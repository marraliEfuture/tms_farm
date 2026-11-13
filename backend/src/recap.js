/* Recap ai clienti: una mail al contatto del ticket (la persona che ha chiesto) quando il ticket
   viene aperto, quando si fissa l'intervento e quando si chiude, più un riepilogo settimanale
   delle richieste aperte. Ogni invio finisce nel registro con il suo esito, così si sa sempre
   chi l'ha ricevuto e chi no:
   - «manca la mail»: il contatto non ha un indirizzo, il recap non può partire
   - «preparata»: modalità prova, la mail è in outbox ma non spedita
   - «accettata»: il server di posta l'ha presa in carico per quel destinatario
   - «rifiutata» / «errore»: il server non l'ha presa; si riprova da solo fino a 3 volte
   - «non consegnata»: è tornato un avviso di mancata consegna nella casella di raccolta
   - «letta»: è tornata la conferma di lettura (se il programma di posta del cliente la manda) */
const store = require("./store");
const settings = require("./settings");
const mail = require("./mail");

const KIND = {
  apertura: "Abbiamo preso in carico la sua richiesta",
  intervento: "Intervento fissato",
  chiusura: "Richiesta chiusa",
  settimanale: "Riepilogo settimanale delle sue richieste",
  prova: "Mail di prova dei recap",
};
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const when = p => { if (!p) return "da fissare"; const d = new Date(); d.setDate(d.getDate() + p.day); return d.toLocaleDateString("it-CH", { weekday: "long", day: "numeric", month: "long" }) + " alle " + p.time; };
const now = () => new Date().toISOString();
const isMail = v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || ""));
const list = () => { const st = store.load(); st.recaps = st.recaps || []; return st.recaps; };

/* la persona del ticket: quella indicata, altrimenti il primo contatto dell'azienda con una mail */
function personOf(t, clients) {
  const c = clients.find(x => x.id === t.client) || { contacts: [] };
  const live = (c.contacts || []).filter(k => !k.eliminato);
  return { c, k: live.find(k => k.id === t.contatto) || live.find(k => isMail(k.mail)) || live[0] || null };
}

function ticketText(t, k, kind, tech) {
  const nome = k ? String(k.n).split(" ")[0] : "";
  const righe = [
    "Buongiorno" + (nome ? " " + nome : "") + ",", "",
    kind === "apertura" ? "abbiamo ricevuto la sua richiesta e l'abbiamo registrata con il numero " + t.id + "." :
    kind === "intervento" ? "le confermiamo l'intervento per la richiesta " + t.id + ": " + when(t.plan) + "." :
    "la richiesta " + t.id + " è stata chiusa. Se qualcosa non va, risponda a questa mail e la riapriamo.", "",
    "Richiesta: " + t.title,
    "Stato: " + t.state,
    "Intervento: " + when(t.plan),
  ];
  if (tech) righe.push("Tecnico: " + tech);
  righe.push("", "Per qualsiasi cosa risponda a questa mail: la risposta resta collegata alla richiesta " + t.id + ".", "", "Cordiali saluti", "Assistenza tecnica");
  return righe.join("\n");
}
function weeklyText(c, k, tickets) {
  const nome = k ? String(k.n).split(" ")[0] : "";
  return ["Buongiorno" + (nome ? " " + nome : "") + ",", "", "ecco le richieste aperte di " + c.name + ":", "",
    ...tickets.map(t => "• " + t.id + " — " + t.title + "\n  Stato: " + t.state + " · Intervento: " + when(t.plan)), "",
    "Per qualsiasi richiesta risponda a questa mail.", "", "Cordiali saluti", "Assistenza tecnica"].join("\n");
}

function build(entry, text, t) {
  const sup = settings.support();
  const headers = { "X-TicketFarm-Recap": entry.id, "X-TicketFarm-Recap-Tipo": entry.kind };
  if (settings.recap().conferma) { headers["Disposition-Notification-To"] = sup; headers["Return-Receipt-To"] = sup; }
  const msg = { from: { name: "Assistenza tecnica", address: sup }, to: entry.to, replyTo: sup, subject: entry.subj, text, headers };
  const ref = t && (t.msgIds || []).slice(-1)[0];
  if (ref) { msg.inReplyTo = ref; msg.references = [ref]; }
  return msg;
}

/* spedisce e registra l'esito per quel destinatario */
async function deliver(entry, msg) {
  entry.tentativi = (entry.tentativi || 0) + 1; entry.ultimo = now();
  try {
    const r = await mail.send(msg);
    entry.messageId = r.messageId || "";
    const to = String(entry.to).toLowerCase();
    if (!r.real) { entry.stato = "preparata"; entry.dettaglio = "Modalità prova: mail salvata in outbox, non spedita."; }
    else if (r.rejected.map(x => x.toLowerCase()).includes(to)) { entry.stato = "rifiutata"; entry.dettaglio = "Il server di posta non ha accettato il destinatario. " + (r.response || ""); }
    else { entry.stato = "accettata"; entry.dettaglio = "Il server di posta l'ha presa in carico" + (r.response ? " (" + r.response.slice(0, 80) + ")" : "") + "."; }
  } catch (e) { entry.stato = "errore"; entry.dettaglio = "Invio non riuscito: " + e.message; }
  store.save();
  return entry;
}

/* recap di un ticket: kind = apertura | intervento | chiusura */
async function forTicket(t, clients, kind, techName, force) {
  const cfgR = settings.recap();
  if (!force && (!cfgR.attivo || !cfgR[kind])) return null;
  const { c, k } = personOf(t, clients);
  const entry = { id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind, ticket: t.id, client: c.id || t.client, contatto: k ? k.id : "",
    nome: k ? k.n : "", to: k && isMail(k.mail) ? k.mail : "", subj: t.id + " - " + t.title + ": " + KIND[kind].toLowerCase(), at: now(), stato: "", tentativi: 0 };
  list().unshift(entry); store.load().recaps = list().slice(0, 1000);
  if (!entry.to) { entry.stato = "manca la mail"; entry.dettaglio = k ? k.n + " non ha un indirizzo mail: aggiungilo in Anagrafiche." : "Nessun contatto per questo cliente."; store.save(); return entry; }
  return deliver(entry, build(entry, ticketText(t, k, kind, techName), t));
}

/* riepilogo settimanale: una mail per persona con le sue richieste aperte */
async function weekly(clients, tickets) {
  const out = [], groups = new Map();
  for (const t of tickets.filter(x => x.state !== "Chiuso")) {
    const { c, k } = personOf(t, clients);
    const key = (k && k.id) || "az:" + c.id;
    if (!groups.has(key)) groups.set(key, { c, k, tickets: [] });
    groups.get(key).tickets.push(t);
  }
  for (const { c, k, tickets: ts } of groups.values()) {
    const entry = { id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: "settimanale", ticket: ts.map(t => t.id).join(", "), client: c.id, contatto: k ? k.id : "",
      nome: k ? k.n : "", to: k && isMail(k.mail) ? k.mail : "", subj: KIND.settimanale + " — " + c.name, at: now(), stato: "", tentativi: 0 };
    list().unshift(entry);
    if (!entry.to) { entry.stato = "manca la mail"; entry.dettaglio = (k ? k.n : c.name) + " non ha un indirizzo mail."; out.push(entry); continue; }
    out.push(await deliver(entry, build(entry, weeklyText(c, k, ts), null)));
  }
  const st = store.load(); st.recaps = list().slice(0, 1000); st.recapWeek = weekKey(); store.save();
  return out;
}
const weekKey = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

async function test(to) {
  if (!isMail(to)) return { error: "indirizzo non valido" };
  const entry = { id: "r" + Date.now().toString(36), kind: "prova", ticket: "", client: "", contatto: "", nome: to, to, subj: KIND.prova, at: now(), stato: "", tentativi: 0 };
  list().unshift(entry);
  return deliver(entry, build(entry, "Questa è una mail di prova dei recap di Ticket Farm.\nSe la ricevi, i recap ai clienti partono correttamente.", null));
}

/* riprova gli invii non riusciti (fino a 3 tentativi) */
async function retry(clients, tickets, id) {
  const todo = list().filter(e => (id ? e.id === id : true) && ["errore", "rifiutata"].includes(e.stato) && (id || e.tentativi < 3));
  for (const e of todo) {
    if (e.kind === "settimanale" || e.kind === "prova") { await deliver(e, build(e, e.kind === "prova" ? "Mail di prova dei recap." : weeklyText(clients.find(c => c.id === e.client) || { name: "" }, { n: e.nome }, tickets.filter(t => e.ticket.split(", ").includes(t.id))), null)); continue; }
    const t = tickets.find(x => x.id === e.ticket); if (!t) continue;
    await deliver(e, build(e, ticketText(t, { n: e.nome }, e.kind, ""), t));
  }
  return todo;
}

/* avvisi di mancata consegna e conferme di lettura arrivati alla casella di raccolta */
const NDR = /(undeliver|non recapitabil|mancata consegna|delivery status notification|delivery has failed|mail delivery failed|returned mail|unzustellbar|failure notice)/i;
const MDN = /^(letto|read|gelesen|lu)\s*:/i;
function checkInbound(mails) {
  let changed = 0;
  for (const m of mails || []) {
    const blob = [m.subj, m.body, ...(m.hdr || []).map(h => h.join(": "))].join("\n");
    const ndr = NDR.test(m.subj || ""), mdn = MDN.test(m.subj || "");
    if (!ndr && !mdn) continue;
    for (const e of list()) {
      if (!e.to || !["accettata", "preparata", "letta"].includes(e.stato)) continue;
      const hit = (e.messageId && blob.includes(e.messageId)) || blob.includes("X-TicketFarm-Recap: " + e.id) || (ndr && blob.toLowerCase().includes(e.to.toLowerCase()) && blob.includes(e.subj.slice(0, 20)));
      if (!hit) continue;
      if (ndr && e.stato !== "non consegnata") { e.stato = "non consegnata"; e.dettaglio = "Tornato un avviso di mancata consegna: «" + String(m.subj).slice(0, 80) + "». Controlla l'indirizzo di " + e.nome + "."; changed++; }
      else if (mdn && e.stato !== "letta") { e.stato = "letta"; e.dettaglio = "Conferma di lettura ricevuta."; changed++; }
    }
  }
  if (changed) store.save();
  return changed;
}

/* contatti che oggi non riceverebbero i recap: richiedenti di ticket aperti senza mail */
function missing(clients, tickets) {
  const seen = new Map();
  for (const t of tickets.filter(x => x.state !== "Chiuso")) {
    const { c, k } = personOf(t, clients);
    if (k && isMail(k.mail)) continue;
    const key = (k && k.id) || "az:" + c.id;
    if (!seen.has(key)) seen.set(key, { client: c.id, azienda: c.name, contatto: k ? k.id : "", nome: k ? k.n : "", tel: k ? k.tel || "" : "", ticket: [] });
    seen.get(key).ticket.push(t.id);
  }
  return [...seen.values()];
}

/* da chiamare periodicamente: riprova i falliti e manda il settimanale nel giorno e nell'ora scelti */
async function tick(getData) {
  const r = settings.recap(), d = new Date();
  const { clients, tickets } = await getData();
  await retry(clients, tickets);
  const st = store.load();
  if (r.attivo && r.settimanale && d.getDay() === r.giorno && d.getHours() >= r.ora && st.recapWeek !== weekKey(d)) await weekly(clients, tickets);
}

module.exports = { forTicket, weekly, test, retry, checkInbound, missing, tick, list, KIND, GIORNI, personOf };

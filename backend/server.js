/* Ticket Farm · backend
   - /api/app/*   API per l'app dei tecnici (accesso con mail + codice)
   - /admin       console dell'ufficio (utente e password)
   - /api/admin/* dati della console */
const path = require("path");
const express = require("express");
const cfg = require("./src/config");
const store = require("./src/store");
const auth = require("./src/auth");
const sources = require("./src/connectors");
const mail = require("./src/mail");
const { recognize } = require("./src/recognize");

const app = express();
app.use(express.json({ limit: "20mb" }));

/* l'app può essere pubblicata su un altro indirizzo (es. GitHub Pages): CORS solo da lì */
app.use("/api/app", (req, res, next) => {
  const origin = req.headers.origin || "";
  let allowed = "*";
  try { if (cfg.appUrl) allowed = new URL(cfg.appUrl).origin; } catch (e) { /* APP_URL non valido: resta aperto */ }
  if (allowed === "*" || origin === allowed) res.set("Access-Control-Allow-Origin", origin || "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization").set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const now = () => new Date().toLocaleTimeString("it-CH", { hour: "2-digit", minute: "2-digit" });
const techsPublic = () => { const st = store.load(); return auth.techs().map(({ hash, codice, ...t }) => ({ ...t, app: !!st.threads[t.mail], last: (st.mails.find(m => m.from === t.mail) || {}).at || "—" })); };

/* clienti con contatti, numeri salvati dall'app e ticket aperti */
async function clientsWithOpen() {
  const st = store.load();
  const { clients, tickets } = await sources.data();
  return clients.map(c => ({
    ...c,
    contacts: c.contacts.map((k, i) => (i === 0 && !k.tel && st.phones[c.id] ? { ...k, tel: st.phones[c.id] } : k)),
    open: tickets.filter(t => t.client === c.id && t.state !== "Chiuso").map(t => ({ id: t.id, t: t.title, urg: !!t.urg })),
  }));
}
async function appData(tech) {
  const st = store.load();
  if (!st.threads[tech.mail]) { st.threads[tech.mail] = JSON.parse(JSON.stringify((cfg.mode === "demo" && sources.demo.seedThreads[tech.mail]) || [])); store.save(); }
  return { me: { mail: tech.mail, ini: tech.ini, zona: tech.zona, nome: tech.nome }, support: cfg.support, mode: cfg.mode,
    clients: await clientsWithOpen(), threads: st.threads[tech.mail] };
}
/* registra la mail nel registro della console, con il riconoscimento che ne farebbe il backend */
async function logMail(msg, sent) {
  const st = store.load();
  const { clients, tickets } = await sources.data();
  const hdr = Object.entries(msg.headers || {});
  if (msg.inReplyTo) hdr.unshift(["In-Reply-To", msg.inReplyTo], ["References", msg.inReplyTo]);
  const entry = { id: "m" + Date.now(), at: now(), from: msg.from.address, fromName: msg.from.name, subj: msg.subject, hdr, body: msg.text,
    sent: { real: sent.real, messageId: sent.messageId, file: sent.file ? path.basename(sent.file) : "" } };
  const r = recognize({ from: entry.from, subject: entry.subj, headers: hdr }, { techs: auth.techs(), clients, tickets, rules: st.rules });
  entry.res = { ...r, act: sent.real ? "Mail spedita a " + cfg.support + "." : "Modalità prova: mail salvata in outbox/" + path.basename(sent.file || "") + ", non spedita." };
  st.mails.unshift(entry); st.mails = st.mails.slice(0, 500); store.save();
  return entry;
}

/* ---------------- API app ---------------- */
app.get("/api/app/info", (req, res) => res.json({ mode: cfg.mode, demo: auth.demoHint() }));
app.post("/api/app/login", (req, res) => {
  const token = auth.login(req.body.mail, req.body.code);
  if (!token) return res.status(401).json({ error: "mail o codice non corretti" });
  res.json({ token });
});
app.get("/api/app/data", auth.requireTech, async (req, res, next) => { try { res.json(await appData(req.tech)); } catch (e) { next(e); } });
app.post("/api/app/read", auth.requireTech, (req, res) => {
  const st = store.load(); const th = (st.threads[req.tech.mail] || []).find(t => t.ticket === req.body.ticket);
  if (th) { th.unread = false; store.save(); }
  res.json({ ok: true });
});

app.post("/api/app/send", auth.requireTech, async (req, res, next) => {
  try {
    const b = req.body || {}, tech = req.tech, st = store.load();
    if (!b.body && !(b.files || []).length) return res.status(400).json({ error: "manca il messaggio del cliente" });
    const { clients, tickets } = await sources.data();
    const c = b.client ? clients.find(x => x.id === b.client) : null;
    if (b.client && !c) return res.status(400).json({ error: "cliente non trovato" });
    const existing = c && b.dest && b.dest !== "new" ? tickets.find(t => t.id === b.dest) : null;

    let ticket, subject, inReplyTo = "", isNew = false;
    if (existing) {
      ticket = existing.id; subject = "Re: " + existing.id + " - " + existing.title; inReplyTo = (existing.msgIds || []).slice(-1)[0] || "";
    } else {
      isNew = true;
      subject = (b.kind === "mail" && b.subj ? b.subj : (b.kind === "mail" ? "Mail del cliente" : "Messaggio WhatsApp")) + " - " + (c ? c.name : "cliente da identificare");
      /* in prova simuliamo il numero che ITSM/Halo assegnerebbero; dal vivo il numero arriva quando il sistema lo apre */
      ticket = c && cfg.mode === "demo" ? sources.demo.createTicket(c, String(b.body).slice(0, 60), tech.ini) : "In attesa-" + (++st.seq);
    }
    const text = mail.bodyText({ kind: b.kind, from: b.from, mailFrom: b.mailFrom, time: b.time, lines: b.lines, body: b.body, note: b.note });
    const msg = mail.buildMessage({ tech, client: c, ticket: existing ? ticket : "", isNew, subject, text, inReplyTo, time: b.time,
      origin: b.kind === "mail" ? "mail del cliente" + (b.mailFrom ? " (" + b.mailFrom + ")" : "") : "WhatsApp del tecnico", files: b.files });
    const sent = await mail.send(msg);
    await logMail(msg, sent);

    if (c && b.remember && b.number) st.phones[c.id] = b.number;
    const threads = st.threads[tech.mail] = st.threads[tech.mail] || [];
    let th = threads.find(t => t.ticket === ticket);
    if (!th) { th = { ticket, client: c ? c.id : null, unread: false, msgs: [] }; threads.unshift(th); }
    th.msgs.push({ k: "fwd", kind: b.kind, from: b.from || "", t: b.time || now(), text: b.body, lines: b.lines || null, photos: (b.files || []).length });
    if (b.note) th.msgs.push({ k: "me", t: now(), text: b.note });
    const where = sent.real ? "Mail spedita a " + cfg.support : "Modalità prova: mail preparata ma non spedita";
    th.msgs.push({ k: "tf", t: now(), text: where + (existing ? ", collegata a " + ticket + "." : isNew && c ? ". " + (cfg.mode === "demo" ? "Ticket " + ticket + " aperto (simulato)." : "Il numero del ticket comparirà quando " + c.sys + " lo apre.") : ". L'ufficio identificherà il cliente."),
      forClient: isNew && c && cfg.mode === "demo" ? "Buongiorno, abbiamo registrato la sua richiesta con il numero " + ticket + ". La ricontattiamo al più presto. Grazie." : undefined });
    store.save();
    res.json({ ticket, data: await appData(tech) });
  } catch (e) { next(e); }
});

app.post("/api/app/note", auth.requireTech, async (req, res, next) => {
  try {
    const st = store.load(), tech = req.tech, text = String(req.body.text || "").trim();
    const th = (st.threads[tech.mail] || []).find(t => t.ticket === req.body.ticket);
    if (!th || !text) return res.status(400).json({ error: "conversazione o testo mancante" });
    const { tickets } = await sources.data();
    const t = tickets.find(x => x.id === th.ticket);
    const msg = mail.buildMessage({ tech, client: null, ticket: th.ticket, isNew: false, subject: "Re: " + th.ticket + (t ? " - " + t.title : ""),
      text: text + "\n\n-- Nota del tecnico inviata con l'app Ticket Farm --", inReplyTo: t ? (t.msgIds || []).slice(-1)[0] || "" : "", time: "", origin: "nota del tecnico" });
    const sent = await mail.send(msg);
    await logMail(msg, sent);
    th.msgs.push({ k: "me", t: now(), text });
    th.msgs.push({ k: "tf", t: now(), text: sent.real ? "Mail spedita a " + cfg.support + "." : "Modalità prova: mail preparata ma non spedita." });
    store.save();
    res.json({ data: await appData(tech) });
  } catch (e) { next(e); }
});

/* ---------------- console dell'ufficio ---------------- */
app.use(["/admin", "/api/admin"], auth.requireAdmin);
/* l'app del tecnico è servita dallo stesso server: niente GitHub Pages, il repository può restare privato */
const APP_DIR = path.join(__dirname, "..", "app");
app.get("/app/config.js", (req, res) => res.type("application/javascript").send("window.TF_CONFIG = { backendUrl: location.origin };"));
app.use("/app", express.static(APP_DIR));
app.get("/", (req, res) => res.redirect("/app/"));
app.use("/admin", express.static(path.join(__dirname, "admin")));

app.get("/api/admin/state", async (req, res, next) => {
  try {
    const st = store.load();
    const { clients, tickets } = await sources.data();
    let mails = st.mails;
    if (cfg.mode === "demo") {
      const extra = sources.demo.inbound.filter(m => !st.mails.some(x => x.id === m.id)).map(m => ({ ...m,
        res: { ...recognize({ from: m.from, subject: m.subj, headers: m.hdr }, { techs: auth.techs(), clients, tickets, rules: st.rules }), act: "Esempio di mail arrivata direttamente da un cliente." } }));
      mails = [...st.mails, ...extra];
    }
    res.json({ mode: cfg.mode, support: cfg.support, appUrl: cfg.appUrl, clients, tickets, techs: techsPublic(), mails, rules: st.rules, connections: await sources.status() });
  } catch (e) { next(e); }
});
app.post("/api/admin/mails/:id/resolve", async (req, res, next) => {
  try {
    const st = store.load();
    const { clients } = await sources.data();
    const c = clients.find(x => x.id === req.body.client);
    let m = st.mails.find(x => x.id === req.params.id);
    if (!m && cfg.mode === "demo") { const d = sources.demo.inbound.find(x => x.id === req.params.id); if (d) { m = { ...d }; st.mails.push(m); } }
    if (!m || !c) return res.status(400).json({ error: "mail o cliente non trovati" });
    const ticket = cfg.mode === "demo" ? sources.demo.createTicket(c, m.subj, "") : "";
    m.res = { ...(m.res || {}), state: "new", client: c.id, ticket, act: ticket ? "Aperto " + ticket + " per " + c.name + " (simulato)." : "Cliente indicato: " + c.name + ". Il ticket va aperto in " + c.sys + "." };
    store.save();
    res.json({ ok: true, mail: m });
  } catch (e) { next(e); }
});
app.post("/api/admin/rules", (req, res) => {
  const st = store.load(); const r = st.rules.find(x => x.k === req.body.k);
  if (r) { r.on = !!req.body.on; store.save(); }
  res.json({ rules: st.rules });
});

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message || "errore del server" }); });

if (require.main === module) {
  app.listen(cfg.port, () => {
    console.log(`Ticket Farm backend su http://localhost:${cfg.port} (modalità ${cfg.mode})`);
    if (cfg.mode === "demo") console.log("Prova: accedi dall'app con mb@efuture.it e codice 123456. Le mail vanno in backend/outbox.");
    if (cfg.mode === "live" && !auth.techs().length) console.log("Attenzione: nessun tecnico. Aggiungili con: npm run codice -- mail@efuture.it \"Nome\" INI Zona");
    if (cfg.secret === "solo-per-prova") console.log("Attenzione: imposta SECRET in .env");
  });
}
module.exports = app;

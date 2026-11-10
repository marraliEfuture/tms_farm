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
const logos = require("./src/logos");
const settings = require("./src/settings");
const audit = require("./src/audit");
const ai = require("./src/ai");
const graph = require("./src/connectors/graph");

const app = express();
app.set("trust proxy", true);   /* dietro nginx/Apache: indirizzo e https corretti per le passkey e i link */
const webauthn = require("@simplewebauthn/server");
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

const mailAddr = x => { const m = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(String(x || "")); return m ? m[0].toLowerCase() : ""; };
/* mail del cliente per la copia: quella salvata sulla conversazione, l'ultima mail inoltrata, o una mail arrivata a support sul ticket (mai un tecnico) */
function clientMailOf(th, st, tech) {
  const techMails = new Set(auth.techs().map(t => String(t.mail).toLowerCase()));
  const ok = a => a && !techMails.has(a) && a !== String(settings.support()).toLowerCase();
  if (ok(th.clientMail)) return th.clientMail;
  const f = [...(th.msgs || [])].reverse().find(m => m.k === "fwd" && ok(mailAddr(m.mailFrom)));
  if (f) return mailAddr(f.mailFrom);
  const inbound = [...(st.mails || []), ...(cfg.mode === "demo" ? sources.demo.inbound : [])].reverse()
    .find(m => ok(mailAddr(m.from)) && ((m.res && m.res.ticket === th.ticket) || String(m.subj || "").includes(th.ticket)));
  return inbound ? mailAddr(inbound.from) : "";
}
const now = () => new Date().toLocaleTimeString("it-CH", { hour: "2-digit", minute: "2-digit" });
const techsPublic = () => { const st = store.load(); return auth.techs().map(({ hash, codice, ...t }) => ({ ...t, app: !!st.threads[t.mail], last: (st.mails.find(m => m.from === t.mail) || {}).at || "—" })); };

/* clienti con contatti, numeri salvati dall'app e ticket aperti */
async function clientsWithOpen() {
  const st = store.load();
  const { clients, tickets } = await sources.data();
  return clients.map(c => ({
    ...c,
    contacts: c.contacts.map((k, i) => (i === 0 && !k.tel && st.phones[c.id] ? { ...k, tel: st.phones[c.id] } : k)),
    open: tickets.filter(t => t.client === c.id && t.state !== "Chiuso").map(t => ({ id: t.id, t: t.title, urg: !!t.urg, state: t.state, plan: t.plan || null, tech: t.tech || "" })),
  }));
}
async function appData(tech) {
  const st = store.load();
  if (!st.threads[tech.mail]) { st.threads[tech.mail] = JSON.parse(JSON.stringify((cfg.mode === "demo" && sources.demo.seedThreads[tech.mail]) || [])); store.save(); }
  return { me: { mail: tech.mail, ini: tech.ini, zona: tech.zona, nome: tech.nome }, support: settings.support(), mode: cfg.mode,
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
  entry.res = { ...r, act: sent.real ? "Mail spedita a " + settings.support() + "." : "Modalità prova: mail salvata in outbox/" + path.basename(sent.file || "") + ", non spedita." };
  st.mails.unshift(entry); st.mails = st.mails.slice(0, 500); store.save();
  return entry;
}

/* ---------------- API app ---------------- */
/* codice dimenticato: nuovo codice mandato alla mail aziendale del tecnico (in prova torna anche nella risposta) */
app.post("/api/app/forgot", async (req, res, next) => {
  try {
    const mailAddr = String(req.body.mail || "").trim().toLowerCase(), t = auth.findTech(mailAddr);
    const out = { ok: true, message: "Se la mail è di un tecnico registrato, gli abbiamo mandato un nuovo codice." };
    if (t) {
      const r = auth.editTech(t.mail, { newCode: true });
      await mail.send({ from: { name: "Ticket Farm", address: settings.support() }, to: t.mail, subject: "Ticket Farm: il tuo nuovo codice",
        text: "Ciao " + (t.nome || "") + ",\n\nil tuo nuovo codice per l'app Ticket Farm è: " + r.code + "\n\nIl codice precedente non funziona più. Se non l'hai chiesto tu, avvisa l'ufficio." });
      audit.add(t.mail, "Nuovo codice richiesto dall'app", "mandato a " + t.mail, "app");
      if (cfg.mode === "demo") out.demoCode = r.code;
    }
    res.json(out);
  } catch (e) { next(e); }
});
app.get("/api/app/logo", async (req, res) => {
  const got = await logos.get(req.query.d);
  if (!got) return res.set("Cache-Control", "public, max-age=86400").sendStatus(404);
  res.set("Cache-Control", "public, max-age=604800").type(got.type).send(got.buf);
});
app.get("/api/app/info", (req, res) => res.json({ mode: cfg.mode, demo: auth.demoHint() }));
app.post("/api/app/login", (req, res) => {
  const token = auth.login(req.body.mail, req.body.code);
  if (!token) return res.status(401).json({ error: "mail o codice non corretti" });
  res.json({ token });
});
app.get("/api/app/data", auth.requireTech, async (req, res, next) => { try { res.json(await appData(req.tech)); } catch (e) { next(e); } });
/* promemoria e ordine delle attività per il tecnico collegato all'app */
app.get("/api/app/ai/agenda", auth.requireTech, async (req, res, next) => { try { res.json(await aiAgenda(req.tech.ini, req.query.fresh === "1")); } catch (e) { next(e); } });
app.get("/api/app/ai", auth.requireTech, (req, res) => res.json({ enabled: settings.ai().enabled, model: settings.ai().model, promemoria: settings.ai().promemoria, priorita: settings.ai().priorita }));
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
    audit.add(tech.mail, "Messaggio inoltrato dall'app", (c ? c.name : "cliente da identificare") + " · " + ticket, "app");

    if (c && b.remember && b.number) st.phones[c.id] = b.number;
    const threads = st.threads[tech.mail] = st.threads[tech.mail] || [];
    let th = threads.find(t => t.ticket === ticket);
    if (!th) { th = { ticket, client: c ? c.id : null, unread: false, msgs: [] }; threads.unshift(th); }
    const cm = b.kind === "mail" ? mailAddr(b.mailFrom) : "";
    if (cm) th.clientMail = cm;
    th.msgs.push({ k: "fwd", kind: b.kind, mailFrom: cm || undefined, from: b.from || "", t: b.time || now(), text: b.body, lines: b.lines || null, photos: (b.files || []).length });
    if (b.note) th.msgs.push({ k: "me", t: now(), text: b.note });
    /* nessun messaggio di conferma: solo, per un ticket nuovo, il numero e il testo da girare al cliente */
    if (isNew && c && cfg.mode === "demo") th.msgs.push({ k: "tf", t: now(), text: "Nuovo ticket " + ticket + ".",
      forClient: "Buongiorno, abbiamo registrato la sua richiesta con il numero " + ticket + ". La ricontattiamo al più presto. Grazie." });
    else if (!c) th.msgs.push({ k: "tf", t: now(), text: "Cliente da identificare: l'ufficio ti scrive qui appena lo trova." });
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
    /* se il cliente ha scritto per mail, la risposta del tecnico gli arriva in copia (si può togliere dall'app) */
    const cc = req.body.cc ? clientMailOf(th, st, tech) : "";
    const msg = mail.buildMessage({ tech, client: null, ticket: th.ticket, isNew: false, subject: "Re: " + th.ticket + (t ? " - " + t.title : ""), cc,
      text: text + (cc ? "\n\n-- " + (tech.nome || tech.mail) + ", tecnico Efuture. Rispondendo a questa mail la risposta resta nel ticket " + th.ticket + ". --" : "\n\n-- Nota del tecnico inviata con l'app Ticket Farm --"),
      inReplyTo: t ? (t.msgIds || []).slice(-1)[0] || "" : "", time: "", origin: cc ? "risposta del tecnico al cliente" : "nota del tecnico" });
    const sent = await mail.send(msg);
    await logMail(msg, sent);
    if (cc) audit.add(tech.mail, "Risposta al cliente dall'app", th.ticket + " · copia a " + cc, "app");
    th.msgs.push({ k: "me", t: now(), text, cc: cc || undefined });
    store.save();
    res.json({ data: await appData(tech) });
  } catch (e) { next(e); }
});

/* ---------------- console dell'ufficio ---------------- */
/* accesso alla console: la pagina /admin è pubblica e mostra il login, i dati (/api/admin/*) richiedono l'accesso */
app.get("/api/admin/info", (req, res) => res.json({ mode: cfg.mode, demo: auth.adminDemoHint(), configured: !!auth.adminAccount() }));
app.post("/api/admin/login", (req, res) => {
  const r = auth.adminLogin(req.body.user, req.body.password);
  if (!r) { audit.add(String(req.body.user || "").slice(0, 60), "Accesso non riuscito", "", "accesso"); return res.status(401).json({ error: auth.adminAccount() ? "utente o password non corretti" : "imposta ADMIN_PASSWORD in .env" }); }
  if (r.need2fa) return res.json({ need2fa: true, ticket: r.ticket });
  const me = auth.publicAdmin(auth.findUser(req.body.user));
  audit.add(me.user, "Accesso alla console", "password", "accesso");
  res.json({ token: r.token, me });
});
app.post("/api/admin/login/2fa", (req, res) => {
  const r = auth.adminLogin2fa(req.body.ticket, req.body.code);
  if (r.error) { const o = auth.readSigned(req.body.ticket); audit.add(o ? o.user : "—", "Codice di verifica errato", "", "accesso"); return res.status(401).json({ error: r.error }); }
  audit.add(r.acc.user, "Accesso alla console", r.usedRecovery ? "con un codice di recupero (ne restano " + r.left + ")" : "password + codice", "accesso");
  res.json({ token: r.token, me: auth.publicAdmin(r.acc), usedRecovery: !!r.usedRecovery, left: r.left });
});
/* password dimenticata: mail con un link valido 30 minuti (in prova la mail resta in outbox e il link torna nella risposta) */
const baseUrl = req => req.protocol + "://" + req.get("host");
app.post("/api/admin/forgot", async (req, res, next) => {
  try {
    const f = auth.forgot(req.body.user);
    const out = { ok: true, message: "Se l'utente esiste ed ha una mail, gli abbiamo mandato il link per scegliere una nuova password." };
    if (f) {
      const link = baseUrl(req) + "/admin/#reset=" + f.token;
      await mail.send({ from: { name: "Ticket Farm", address: settings.support() }, to: f.acc.mail, subject: "Ticket Farm: nuova password",
        text: "Ciao " + (f.acc.nome || f.acc.user) + ",\n\nper scegliere una nuova password della console apri questo link entro 30 minuti:\n" + link + "\n\nSe non l'hai chiesto tu, ignora questa mail: la password attuale resta valida." });
      audit.add(f.acc.user, "Richiesta nuova password", "link mandato a " + f.acc.mail, "accesso");
      if (cfg.mode === "demo") out.demoLink = link;
    }
    res.json(out);
  } catch (e) { next(e); }
});
app.post("/api/admin/reset", (req, res) => {
  const r = auth.resetPassword(req.body.token, req.body.password);
  if (r.error) return res.status(400).json(r);
  audit.add(r.user, "Password reimpostata", "dal link via mail", "accesso"); res.json({ ok: true });
});
/* passkey: accesso senza password (impronta, volto, PIN del dispositivo) */
const rp = req => ({ rpID: req.hostname, origin: baseUrl(req) });
const pkLogins = new Map();     /* sfide di accesso in corso, 5 minuti */
app.post("/api/admin/passkey/login/options", async (req, res, next) => {
  try {
    const opts = await webauthn.generateAuthenticationOptions({ rpID: rp(req).rpID, userVerification: "preferred" });
    pkLogins.set(opts.challenge, Date.now() + 5 * 60000); res.json(opts);
  } catch (e) { next(e); }
});
app.post("/api/admin/passkey/login/verify", async (req, res) => {
  try {
    const resp = req.body.response || {}, acc = auth.findByPasskey(resp.id);
    const ch = JSON.parse(Buffer.from((resp.response && resp.response.clientDataJSON) || "", "base64url").toString() || "{}").challenge;
    if (!acc || acc.attivo === false || !pkLogins.has(ch) || pkLogins.get(ch) < Date.now()) return res.status(401).json({ error: "passkey non riconosciuta" });
    pkLogins.delete(ch);
    const pk = acc.passkeys.find(p => p.id === resp.id);
    const v = await webauthn.verifyAuthenticationResponse({ response: resp, expectedChallenge: ch, expectedOrigin: rp(req).origin, expectedRPID: rp(req).rpID,
      credential: { id: pk.id, publicKey: Buffer.from(pk.publicKey, "base64url"), counter: pk.counter, transports: pk.transports } });
    if (!v.verified) return res.status(401).json({ error: "passkey non valida" });
    auth.touchPasskey(acc.user, pk.id, v.authenticationInfo.newCounter);
    audit.add(acc.user, "Accesso alla console", "passkey «" + pk.nome + "»", "accesso");
    res.json({ token: auth.sessionFor(acc), me: auth.publicAdmin(auth.findUser(acc.user)) });
  } catch (e) { res.status(401).json({ error: "passkey non valida: " + e.message }); }
});
app.use("/api/admin", auth.requireAdmin);
/* permessi del profilo: v vedere, m creare/modificare, e eliminare */
const need = (area, right) => (req, res, next) => settings.can(req.admin.profilo || "admin", area, right) ? next() : res.status(403).json({ error: "il tuo profilo non ha questo permesso" });
const log = (req, azione, dettaglio, area) => audit.add(req.admin && req.admin.user, azione, dettaglio, area);
app.get("/api/admin/me", (req, res) => res.json({ me: auth.publicAdmin(req.admin) }));
/* verifica in due passaggi del proprio account */
app.post("/api/admin/2fa/setup", (req, res) => res.json(auth.setup2fa(req.admin)));
app.post("/api/admin/2fa/enable", (req, res) => { const r = auth.enable2fa(req.admin, req.body.code); if (r.error) return res.status(400).json(r); log(req, "Verifica in due passaggi attivata", "", "accesso"); res.json({ ...r, me: auth.publicAdmin(auth.findUser(req.admin.user)) }); });
app.post("/api/admin/2fa/disable", (req, res) => { const r = auth.disable2fa(req.admin, req.body.password, req.body.code); if (r.error) return res.status(400).json(r); log(req, "Verifica in due passaggi disattivata", "", "accesso"); res.json({ ok: true, me: auth.publicAdmin(auth.findUser(req.admin.user)) }); });
/* passkey del proprio account */
app.post("/api/admin/passkey/register/options", async (req, res, next) => {
  try {
    const acc = req.admin;
    const opts = await webauthn.generateRegistrationOptions({ rpName: "Ticket Farm", rpID: rp(req).rpID, userName: acc.user, userDisplayName: acc.nome || acc.user,
      attestationType: "none", excludeCredentials: (acc.passkeys || []).map(p => ({ id: p.id, transports: p.transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" } });
    auth.setPkChallenge(acc, opts.challenge); res.json(opts);
  } catch (e) { next(e); }
});
app.post("/api/admin/passkey/register/verify", async (req, res) => {
  try {
    const acc = auth.findUser(req.admin.user);
    const v = await webauthn.verifyRegistrationResponse({ response: req.body.response, expectedChallenge: acc.pkChallenge, expectedOrigin: rp(req).origin, expectedRPID: rp(req).rpID });
    if (!v.verified) return res.status(400).json({ error: "passkey non verificata" });
    const c = v.registrationInfo.credential;
    const nome = String(req.body.nome || "").slice(0, 40) || "Passkey " + new Date().toLocaleDateString("it-CH");
    auth.addPasskey(acc, { id: c.id, publicKey: Buffer.from(c.publicKey).toString("base64url"), counter: c.counter, transports: c.transports || [], nome, creato: new Date().toISOString() });
    log(req, "Passkey aggiunta", nome, "accesso"); res.json({ ok: true, me: auth.publicAdmin(auth.findUser(acc.user)) });
  } catch (e) { res.status(400).json({ error: "passkey non salvata: " + e.message }); }
});
app.delete("/api/admin/passkey/:id", (req, res) => { if (!auth.removePasskey(req.admin, req.params.id)) return res.status(404).json({ error: "passkey non trovata" }); log(req, "Passkey rimossa", "", "accesso"); res.json({ ok: true, me: auth.publicAdmin(auth.findUser(req.admin.user)) }); });
app.post("/api/admin/profile", (req, res) => {
  const r = auth.updateAdmin(req.body || {}, req.admin);
  if (r.error) return res.status(400).json({ error: r.error });
  log(req, req.body && req.body.nuova ? "Profilo e password aggiornati" : "Profilo aggiornato", "", "profilo");
  res.json(r);
});
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
    /* posta in arrivo letta davvero dalla casella di raccolta (Office 365), se configurata */
    let o365 = null;
    if (graph.configured() && settings.graph().readMail) {
      try {
        if (!inboxCache.at || Date.now() - inboxCache.at > settings.graph().every * 60000) { inboxCache.list = await graph.inbox(25); inboxCache.at = Date.now(); inboxCache.err = ""; }
      } catch (e) { inboxCache.err = e.message; inboxCache.at = Date.now(); }
      o365 = { mailbox: settings.graph().mailbox, error: inboxCache.err, count: (inboxCache.list || []).length };
      const read = (inboxCache.list || []).map(m => ({ ...m, res: { ...recognize({ from: m.from, subject: m.subj, headers: m.hdr }, { techs: auth.techs(), clients, tickets, rules: st.rules }), act: "Letta dalla casella " + settings.graph().mailbox + " (Office 365)." } }));
      mails = [...read, ...st.mails.filter(x => !read.some(r => r.subj === x.subj && r.from === x.from))];
    }
    if (cfg.mode === "demo") {
      const extra = sources.demo.inbound.filter(m => !st.mails.some(x => x.id === m.id)).map(m => ({ ...m,
        res: { ...recognize({ from: m.from, subject: m.subj, headers: m.hdr }, { techs: auth.techs(), clients, tickets, rules: st.rules }), act: "Esempio di mail arrivata direttamente da un cliente." } }));
      mails = [...st.mails, ...extra];
    }
    /* conversazioni dei tecnici con Ticket Farm, ticket per ticket (in prova anche quelle di esempio non ancora aperte dall'app) */
    if (cfg.mode === "demo") for (const [m, list] of Object.entries(sources.demo.seedThreads)) if (!st.threads[m]) { st.threads[m] = JSON.parse(JSON.stringify(list)); store.save(); }
    const tl = auth.techs(), op = (req.admin.profilo || "admin") === "op";
    const threads = Object.entries(st.threads).flatMap(([m, list]) => { const t = tl.find(x => x.mail === m); return (list || []).map(th => ({ ...th, tech: t ? t.ini : "", techMail: m })); })
      .filter(th => !op || th.techMail === req.admin.mail);
    res.json({ threads, ai: settings.aiPublic(), profiles: settings.profiles(), o365, settings: settings.can(req.admin.profilo || "admin", "office365", "v") ? settings.publicView() : null, me: auth.publicAdmin(req.admin), mode: cfg.mode, support: settings.support(), appUrl: cfg.appUrl, clients, tickets, techs: techsPublic(), mails, rules: st.rules, connections: await sources.status() });
  } catch (e) { next(e); }
});
/* l'ufficio scrive nella conversazione del tecnico: il messaggio arriva nell'app come «Ticket Farm» */
app.post("/api/admin/threads/reply", need("ticket", "m"), (req, res) => {
  const st = store.load(), text = String(req.body.text || "").trim().slice(0, 2000), m = String(req.body.techMail || "");
  const th = (st.threads[m] || []).find(t => t.ticket === req.body.ticket);
  if (!th || !text) return res.status(400).json({ error: "conversazione o testo mancante" });
  const msg = { k: "tf", t: now(), text: text, by: req.admin.nome || req.admin.user || "Ufficio" };
  if (req.body.forClient) msg.forClient = String(req.body.forClient).slice(0, 2000);
  th.msgs.push(msg); th.unread = true; store.save();
  log(req, "Messaggio al tecnico", th.ticket + " · " + m, "ticket");
  res.json({ ok: true, msg });
});
app.post("/api/admin/mails/:id/resolve", need("posta", "m"), async (req, res, next) => {
  try {
    const st = store.load();
    const { clients } = await sources.data();
    const c = clients.find(x => x.id === req.body.client);
    let m = st.mails.find(x => x.id === req.params.id);
    if (!m && cfg.mode === "demo") { const d = sources.demo.inbound.find(x => x.id === req.params.id); if (d) { m = { ...d }; st.mails.push(m); } }
    if (!m || !c) return res.status(400).json({ error: "mail o cliente non trovati" });
    const ticket = cfg.mode === "demo" ? sources.demo.createTicket(c, m.subj, "") : "";
    log(req, "Mail verificata", m.subj + " → " + c.name, "posta");
    m.res = { ...(m.res || {}), state: "new", client: c.id, ticket, act: ticket ? "Aperto " + ticket + " per " + c.name + " (simulato)." : "Cliente indicato: " + c.name + ". Il ticket va aperto in " + c.sys + "." };
    store.save();
    res.json({ ok: true, mail: m });
  } catch (e) { next(e); }
});
/* creare ed eliminare ticket: in prova sui dati di esempio; dal vivo vanno fatti in ITSM o Halo (da collegare) */
app.post("/api/admin/tickets", need("ticket", "m"), async (req, res, next) => {
  try {
    const { clients } = await sources.data();
    const c = clients.find(x => x.id === req.body.client), title = String(req.body.title || "").trim().slice(0, 120);
    if (!c || !title) return res.status(400).json({ error: "cliente o richiesta mancanti" });
    if (cfg.mode !== "demo") return res.status(501).json({ error: "dal vivo il ticket va aperto in " + c.sys + ": collegamento non ancora disponibile" });
    const id = sources.demo.createTicket(c, title, String(req.body.tech || ""), { urg: !!req.body.urg, origin: "Console" });
    log(req, "Ticket creato", id + " · " + c.name + " · " + title, "ticket");
    res.json({ ticket: { id, sys: c.sys, client: c.id, title } });
  } catch (e) { next(e); }
});
app.delete("/api/admin/tickets/:id", need("ticket", "e"), (req, res) => {
  if (cfg.mode !== "demo") return res.status(501).json({ error: "dal vivo i ticket si chiudono in ITSM o Halo, non si eliminano da qui" });
  if (!sources.demo.deleteTicket(req.params.id)) return res.status(404).json({ error: "ticket non trovato" });
  log(req, "Ticket eliminato", req.params.id, "ticket");
  res.json({ ok: true });
});
/* clienti: in prova sui dati di esempio; dal vivo le anagrafiche si gestiscono in ITSM o Halo */
const cleanClient = b => ({ name: String(b.name || "").trim().slice(0, 120), city: String(b.city || "").slice(0, 60), sys: b.sys === "Halo" ? "Halo" : "ITSM",
  dom: String(b.dom || "").toLowerCase().replace(/^@/, "").slice(0, 120),
  contacts: (Array.isArray(b.contacts) ? b.contacts : []).slice(0, 20).map(k => ({ n: String(k.n || "").slice(0, 80), mail: String(k.mail || "").slice(0, 120), tel: String(k.tel || "").slice(0, 30), src: k.src === "Halo" ? "Halo" : k.src === "O365" ? "O365" : "ITSM" })) });
const liveOnly = (res, what) => res.status(501).json({ error: "dal vivo " + what + " si gestiscono in ITSM o Halo: collegamento non ancora disponibile" });
app.post("/api/admin/clients", need("clienti", "m"), (req, res) => {
  if (cfg.mode !== "demo") return liveOnly(res, "i clienti");
  const c = cleanClient(req.body || {}); if (!c.name) return res.status(400).json({ error: "ragione sociale mancante" });
  const id = sources.demo.createClient(c); log(req, "Cliente creato", c.name, "clienti");
  res.json({ id });
});
app.put("/api/admin/clients/:id", need("clienti", "m"), (req, res) => {
  if (cfg.mode !== "demo") return liveOnly(res, "i clienti");
  const c = cleanClient(req.body || {}); if (!c.name) return res.status(400).json({ error: "ragione sociale mancante" });
  if (!sources.demo.updateClient(req.params.id, c)) return res.status(404).json({ error: "cliente non trovato" });
  log(req, "Cliente modificato", c.name, "clienti");
  res.json({ ok: true });
});
app.delete("/api/admin/clients/:id", need("clienti", "e"), (req, res) => {
  if (cfg.mode !== "demo") return liveOnly(res, "i clienti");
  if (!sources.demo.deleteClient(req.params.id)) return res.status(404).json({ error: "cliente non trovato" });
  log(req, "Cliente eliminato", req.params.id, "clienti");
  res.json({ ok: true });
});
/* tecnici: account dell'app, gestiti qui (data/tecnici.json) anche dal vivo */
app.post("/api/admin/techs", need("tecnici", "m"), (req, res) => { const r = auth.addTech(req.body || {}); if (r.error) return res.status(400).json(r); log(req, "Tecnico creato", r.tech.mail, "tecnici"); res.json(r); });
app.put("/api/admin/techs/:mail", need("tecnici", "m"), (req, res) => { const r = auth.editTech(req.params.mail, req.body || {}); if (r.error) return res.status(404).json(r); log(req, r.code ? "Nuovo codice al tecnico" : "Tecnico modificato", r.tech.mail, "tecnici"); res.json(r); });
app.delete("/api/admin/techs/:mail", need("tecnici", "e"), (req, res) => { if (!auth.removeTech(req.params.mail)) return res.status(404).json({ error: "tecnico non trovato" }); log(req, "Tecnico eliminato", req.params.mail, "tecnici"); res.json({ ok: true }); });
/* impostazioni: casella di raccolta e Office 365 */
const inboxCache = { at: 0, list: [], err: "" };
app.get("/api/admin/settings", need("office365", "v"), (req, res) => res.json(settings.publicView()));
app.post("/api/admin/settings", need("office365", "m"), (req, res) => {
  const r = settings.update(req.body || {});
  if (r.error) return res.status(400).json(r);
  inboxCache.at = 0; sources.invalidate();
  log(req, "Impostazioni Office 365 salvate", "casella di raccolta " + r.settings.support, "office365");
  res.json(r);
});
app.post("/api/admin/settings/test-o365", need("office365", "m"), async (req, res, next) => { try { res.json(await graph.test()); } catch (e) { next(e); } });
/* assistente AI: promemoria e ordine delle attività di un tecnico */
async function aiAgenda(techIni, fresh) {
  const { clients, tickets } = await sources.data();
  const tech = auth.techs().find(t => t.ini === techIni) || auth.techs()[0] || { ini: techIni };
  const mine = tickets.filter(t => t.tech === tech.ini && t.state !== "Chiuso");
  const input = { tech, tickets: mine, clients, date: new Date().toLocaleDateString("it-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) };
  if (!settings.ai().enabled) return { source: "spento" };
  if (!ai.configured()) return cfg.mode === "demo" ? ai.simulate(input) : { source: "spento", error: "manca la chiave API" };
  try { return await ai.agenda(input, { fresh }); }
  catch (e) { const r = ai.simulate(input); return { source: "regole", error: e.message, order: r.order }; }
}
app.get("/api/admin/ai/team", need("cruscotto", "v"), async (req, res, next) => {
  try {
    if (!settings.ai().enabled) return res.json({ source: "spento" });
    const { clients, tickets } = await sources.data(), st = store.load();
    const input = { tickets: tickets.filter(t => t.state !== "Chiuso"), clients, techs: auth.techs(), date: new Date().toLocaleDateString("it-CH", { weekday: "long", day: "numeric", month: "long" }),
      toCheck: st.mails.filter(m => m.res && m.res.state === "warn").length + (cfg.mode === "demo" ? 1 : 0) };
    if (!ai.configured()) return res.json(cfg.mode === "demo" ? ai.simulateTeam(input) : { source: "spento", error: "manca la chiave API" });
    try { res.json(await ai.team(input, { fresh: req.query.fresh === "1" })); } catch (e) { res.json({ ...ai.simulateTeam(input), source: "regole", error: e.message }); }
  } catch (e) { next(e); }
});
app.get("/api/admin/ai/agenda", need("cruscotto", "v"), async (req, res, next) => { try { res.json(await aiAgenda(String(req.query.tech || "MB"), req.query.fresh === "1")); } catch (e) { next(e); } });
app.get("/api/admin/ai", need("ai", "v"), (req, res) => res.json({ ai: settings.aiPublic(), models: ai.MODELS, techs: auth.techs().length,
  stime: Object.fromEntries(Object.keys(ai.MODELS).map(m => [m, ai.monthlyCost(m, Math.max(1, auth.techs().length), 22)])) }));
app.post("/api/admin/ai", need("ai", "m"), (req, res) => {
  const r = settings.updateAi(req.body || {}); if (r.error) return res.status(400).json(r);
  log(req, r.ai.enabled ? "Assistente AI attivo" : "Assistente AI spento", "modello " + r.ai.model + (req.body.apiKey ? " · nuova chiave" : ""), "ai"); res.json(r);
});
app.post("/api/admin/ai/test", need("ai", "m"), async (req, res, next) => { try { const r = await aiAgenda(String(req.body.tech || "MB"), true); log(req, "Prova dell'assistente AI", r.source, "ai"); res.json(r); } catch (e) { next(e); } });
/* utenti della console */
app.get("/api/admin/users", need("utenti", "v"), (req, res) => res.json({ users: auth.users().map(auth.publicAdmin) }));
app.post("/api/admin/users", need("utenti", "m"), (req, res) => { const r = auth.addUser(req.body || {}); if (r.error) return res.status(400).json(r); log(req, "Utente creato", r.user.user + " (" + r.user.profilo + ")", "utenti"); res.json(r); });
app.put("/api/admin/users/:user", need("utenti", "m"), (req, res) => { const r = auth.editUser(req.params.user, req.body || {}, req.admin); if (r.error) return res.status(400).json(r); log(req, "Utente modificato", r.user.user + (req.body.password ? " · nuova password" : "") + (req.body.attivo === false ? " · disattivato" : ""), "utenti"); res.json(r); });
app.delete("/api/admin/users/:user", need("utenti", "e"), (req, res) => { const r = auth.removeUser(req.params.user, req.admin); if (r.error) return res.status(400).json(r); log(req, "Utente eliminato", req.params.user, "utenti"); res.json(r); });
/* profili e permessi */
app.post("/api/admin/profiles", need("profili", "m"), (req, res) => { const p = settings.updateProfiles(req.body || {}); log(req, "Permessi dei profili aggiornati", "", "profili"); res.json({ profiles: p }); });
/* registro attività */
app.get("/api/admin/audit", need("audit", "v"), (req, res) => res.json({ entries: audit.list().slice(0, 1000) }));
/* backup e ripristino */
app.get("/api/admin/backup", need("backup", "v"), (req, res) => {
  log(req, "Backup scaricato", "", "backup");
  res.set("Content-Disposition", 'attachment; filename="ticketfarm-backup-' + new Date().toISOString().slice(0, 10) + '.json"').json(settings.backupData());
});
app.post("/api/admin/restore", need("backup", "m"), (req, res) => {
  const r = settings.restoreData(req.body); if (r.error) return res.status(400).json(r);
  sources.invalidate(); log(req, "Backup ripristinato", "del " + r.created, "backup"); res.json(r);
});
app.post("/api/admin/rules", need("regole", "m"), (req, res) => {
  const st = store.load(); const r = st.rules.find(x => x.k === req.body.k);
  if (r) { r.on = !!req.body.on; store.save(); log(req, r.on ? "Regola attivata" : "Regola disattivata", r.t, "regole"); }
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

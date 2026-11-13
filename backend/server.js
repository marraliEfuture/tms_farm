/* Ticket Farm · backend
   - /api/app/*   API per l'app dei tecnici (accesso con mail + codice)
   - /admin       console dell'ufficio (utente e password)
   - /api/admin/* dati della console */
const path = require("path");
const express = require("express");
const cfg = require("./src/config");
const store = require("./src/store");
const auth = require("./src/auth");
const recap = require("./src/recap");
const tpl = require("./src/templates");
const files = require("./src/files");
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

/* contatti: persone di un'azienda cliente o fornitrice */
const recapWhen = p => { const d = new Date(); d.setDate(d.getDate() + p.day); return d.toLocaleDateString("it-CH", { weekday: "long", day: "numeric", month: "long" }) + " alle " + p.time; };
const techNameOf = ini => { const t = auth.techs().find(x => x.ini === ini); return t ? t.nome : ""; };
/* recap al cliente senza mai bloccare l'operazione che lo ha fatto partire */
const sendRecap = async (t, kind, extra) => { try { const { clients } = await sources.data(); return await recap.forTicket(t, clients, kind, techNameOf(t.tech), false, extra); } catch (e) { console.error("recap", e.message); return null; } };
const contactOf = (clients, id) => { for (const c of clients) { const k = (c.contacts || []).find(x => x.id && x.id === id); if (k) return { ...k, azienda: c }; } return null; };
const mailAddr = x => { const m = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(String(x || "")); return m ? m[0].toLowerCase() : ""; };
/* mail del cliente per la copia: quella salvata sulla conversazione, l'ultima mail inoltrata, o una mail arrivata a support sul ticket (mai un tecnico) */
let clientsCache = null;
function clientMailOf(th, st, tech) {
  const techMails = new Set(auth.techs().map(t => String(t.mail).toLowerCase()));
  const ok = a => a && !techMails.has(a) && a !== String(settings.support()).toLowerCase();
  /* prima la mail del contatto a cui si sta rispondendo */
  if (th.contatto && clientsCache) { const k = contactOf(clientsCache, th.contatto); if (k && ok(mailAddr(k.mail))) return mailAddr(k.mail); }
  if (ok(th.clientMail)) return th.clientMail;
  const f = [...(th.msgs || [])].reverse().find(m => m.k === "fwd" && ok(mailAddr(m.mailFrom)));
  if (f) return mailAddr(f.mailFrom);
  const inbound = [...(st.mails || []), ...(cfg.mode === "demo" ? sources.demo.inbound : [])].reverse()
    .find(m => ok(mailAddr(m.from)) && ((m.res && m.res.ticket === th.ticket) || String(m.subj || "").includes(th.ticket)));
  return inbound ? mailAddr(inbound.from) : "";
}
const now = () => new Date().toLocaleTimeString("it-CH", { hour: "2-digit", minute: "2-digit" });
const techsPublic = () => { const st = store.load(); return auth.techs().map(({ hash, codice, totp, totpPending, recovery, passkeys, pkChallenge, ...t }) => ({ ...t, twofa: !!totp, passkeys: (passkeys || []).length, attivo: t.attivo !== false && !t.eliminato, aree: t.aree || [], eliminato: t.eliminato || "", app: !!st.threads[t.mail], last: (st.mails.find(m => m.from === t.mail) || {}).at || "—" })); };

/* clienti con contatti, numeri salvati dall'app e ticket aperti */
async function clientsWithOpen() {
  const st = store.load();
  const { clients, tickets } = await sources.data();
  return clients.map(c => ({
    ...c,
    contacts: c.contacts.map((k, i) => (i === 0 && !k.tel && st.phones[c.id] ? { ...k, tel: st.phones[c.id] } : k)),
    open: tickets.filter(t => t.client === c.id && t.state !== "Chiuso").map(t => ({ id: t.id, t: t.title, urg: !!t.urg, state: t.state, plan: t.plan || null, tech: t.tech || "", contatto: t.contatto || "", fornitore: t.fornitore || "" })),
  }));
}
async function appData(tech) {
  const st = store.load(), all = (await sources.data()).tickets, strip = ({ msgIds, ...t }) => t;
  const canZona = (settings.profiles().op.perm.zona || "").includes("v");
  const mieAree = tech.aree || [], colleghi = auth.techs().filter(x => x.ini !== tech.ini && (x.aree || []).some(a => mieAree.includes(a))).map(x => x.ini);
  const inZona = t => t.state !== "Chiuso" && (!t.tech || colleghi.includes(t.tech));
  if (!st.threads[tech.mail]) { st.threads[tech.mail] = JSON.parse(JSON.stringify((cfg.mode === "demo" && sources.demo.seedThreads[tech.mail]) || [])); store.save(); }
  return { me: { mail: tech.mail, ini: tech.ini, zona: tech.zona, nome: tech.nome }, support: settings.support(), mode: cfg.mode,
    clients: await clientsWithOpen(), threads: st.threads[tech.mail],
    /* i suoi ticket, anche chiusi, per la schermata Ticket dell'app */
    tickets: all.filter(t => t.tech === tech.ini).map(strip),
    /* con il permesso "zona" del profilo Tecnico: anche i ticket dei colleghi della stessa area e quelli da assegnare */
    canZona, zoneTickets: canZona ? all.filter(t => t.tech !== tech.ini && inZona(t)).map(strip) : [] };
}
/* registra la mail nel registro della console, con il riconoscimento che ne farebbe il backend */
async function logMail(msg, sent) {
  const st = store.load();
  const { clients, tickets } = await sources.data();
  const hdr = Object.entries(msg.headers || {});
  if (msg.inReplyTo) hdr.unshift(["In-Reply-To", msg.inReplyTo], ["References", msg.inReplyTo]);
  const entry = { id: "m" + Date.now(), at: now(), from: msg.from.address, fromName: msg.from.name, subj: msg.subject, hdr, body: msg.text,
    sent: { real: sent.real, messageId: sent.messageId, file: sent.file ? path.basename(sent.file) : "" } };
  const r = recognize({ from: entry.from, subject: entry.subj, headers: hdr }, { techs: auth.techs(), clients, tickets, rules: st.rules, custom: st.customRules || [] });
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
      const mm = tpl.render("codice_app", { nome: t.nome || "", codice: r.code });
      await mail.send({ from: { name: "Ticket Farm", address: settings.support() }, to: t.mail, subject: mm.oggetto, text: mm.testo });
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
  const r = auth.techLogin(req.body.mail, req.body.code);
  if (!r) return res.status(401).json({ error: "mail o codice non corretti" });
  res.json(r);   /* {token} oppure {need2fa, ticket} se il tecnico ha la verifica in due passaggi */
});
app.post("/api/app/login/2fa", (req, res) => {
  const r = auth.techLogin2fa(req.body.ticket, req.body.code);
  if (r.error) return res.status(401).json(r);
  res.json(r);
});
/* passkey dei tecnici: accesso con impronta, volto o PIN del telefono */
app.post("/api/app/passkey/login/options", async (req, res, next) => {
  try { const opts = await webauthn.generateAuthenticationOptions({ rpID: rp(req).rpID, userVerification: "preferred" }); pkLogins.set(opts.challenge, Date.now() + 5 * 60000); res.json(opts); } catch (e) { next(e); }
});
app.post("/api/app/passkey/login/verify", async (req, res) => {
  try {
    const resp = req.body.response || {}, t = auth.techByPasskey(resp.id);
    const ch = JSON.parse(Buffer.from((resp.response && resp.response.clientDataJSON) || "", "base64url").toString() || "{}").challenge;
    if (!t || t.attivo === false || t.eliminato || !pkLogins.has(ch) || pkLogins.get(ch) < Date.now()) return res.status(401).json({ error: "passkey non riconosciuta" });
    pkLogins.delete(ch);
    const pk = t.passkeys.find(p => p.id === resp.id);
    const v = await webauthn.verifyAuthenticationResponse({ response: resp, expectedChallenge: ch, expectedOrigin: rp(req).origin, expectedRPID: rp(req).rpID,
      credential: { id: pk.id, publicKey: Buffer.from(pk.publicKey, "base64url"), counter: pk.counter, transports: pk.transports } });
    if (!v.verified) return res.status(401).json({ error: "passkey non valida" });
    auth.techTouchPk(t.mail, pk.id, v.authenticationInfo.newCounter);
    audit.add(t.mail, "Accesso all'app", "passkey «" + pk.nome + "»", "accesso");
    res.json({ token: auth.techSession(t) });
  } catch (e) { res.status(401).json({ error: "passkey non valida: " + e.message }); }
});
app.get("/api/app/security", auth.requireTech, (req, res) => res.json(auth.techSecurity(req.tech)));
app.post("/api/app/2fa/setup", auth.requireTech, (req, res) => res.json(auth.techSetup2fa(req.tech)));
app.post("/api/app/2fa/enable", auth.requireTech, (req, res) => { const r = auth.techEnable2fa(req.tech, req.body.code); if (r.error) return res.status(400).json(r); audit.add(req.tech.mail, "Verifica in due passaggi attivata", "app", "accesso"); res.json({ ...r, ...auth.techSecurity(req.tech) }); });
app.post("/api/app/2fa/disable", auth.requireTech, (req, res) => { const r = auth.techDisable2fa(req.tech, req.body.code); if (r.error) return res.status(400).json(r); audit.add(req.tech.mail, "Verifica in due passaggi disattivata", "app", "accesso"); res.json(auth.techSecurity(req.tech)); });
app.post("/api/app/passkey/register/options", auth.requireTech, async (req, res, next) => {
  try {
    const t = req.tech;
    const opts = await webauthn.generateRegistrationOptions({ rpName: "Ticket Farm", rpID: rp(req).rpID, userName: t.mail, userDisplayName: t.nome || t.mail,
      attestationType: "none", excludeCredentials: (t.passkeys || []).map(p => ({ id: p.id, transports: p.transports })), authenticatorSelection: { residentKey: "required", userVerification: "preferred" } });
    auth.techSetPk(t, opts.challenge); res.json(opts);
  } catch (e) { next(e); }
});
app.post("/api/app/passkey/register/verify", auth.requireTech, async (req, res) => {
  try {
    const t = auth.findTech(req.tech.mail);
    const v = await webauthn.verifyRegistrationResponse({ response: req.body.response, expectedChallenge: t.pkChallenge, expectedOrigin: rp(req).origin, expectedRPID: rp(req).rpID });
    if (!v.verified) return res.status(400).json({ error: "passkey non verificata" });
    const c = v.registrationInfo.credential, nome = String(req.body.nome || "").slice(0, 40) || "Telefono " + new Date().toLocaleDateString("it-CH");
    auth.techAddPk(t, { id: c.id, publicKey: Buffer.from(c.publicKey).toString("base64url"), counter: c.counter, transports: c.transports || [], nome, creato: new Date().toISOString() });
    audit.add(t.mail, "Passkey aggiunta", nome, "accesso"); res.json(auth.techSecurity(t));
  } catch (e) { res.status(400).json({ error: "passkey non salvata: " + e.message }); }
});
app.delete("/api/app/passkey/:id", auth.requireTech, (req, res) => { if (!auth.techRemovePk(req.tech, req.params.id)) return res.status(404).json({ error: "passkey non trovata" }); res.json(auth.techSecurity(req.tech)); });
/* allegati: solo per chi ha accesso (tecnico dall'app, ufficio dalla console) */
const sendFile = (req, res) => { const f = files.get(req.params.id); if (!f) return res.sendStatus(404);
  res.set("Content-Type", f.meta.type).set("Content-Disposition", (/^(image|video|audio)\//.test(f.meta.type) || f.meta.type === "application/pdf" ? "inline" : "attachment") + "; filename*=UTF-8''" + encodeURIComponent(f.meta.name)).set("X-Content-Type-Options", "nosniff").sendFile(f.file); };
app.get("/api/app/file/:id", auth.requireTech, sendFile);
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
    /* chi ha scritto: un contatto dell'azienda scelta */
    const k = c && b.contatto ? (c.contacts || []).find(x => x.id === b.contatto) : null;

    let ticket, subject, inReplyTo = "", isNew = false;
    if (existing) {
      ticket = existing.id; subject = "Re: " + existing.id + " - " + existing.title; inReplyTo = (existing.msgIds || []).slice(-1)[0] || "";
    } else {
      isNew = true;
      subject = (b.kind === "mail" && b.subj ? b.subj : (b.kind === "mail" ? "Mail del cliente" : "Messaggio WhatsApp")) + " - " + (c ? c.name : "cliente da identificare");
      /* in prova simuliamo il numero che ITSM/Halo assegnerebbero; dal vivo il numero arriva quando il sistema lo apre */
      ticket = c && cfg.mode === "demo" ? sources.demo.createTicket(c, String(b.body).slice(0, 60), tech.ini, { contatto: k ? k.id : "" }) : "In attesa-" + (++st.seq);
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
    if (isNew && c && cfg.mode === "demo") { const nt = (await sources.data()).tickets.find(x => x.id === ticket); if (nt) await sendRecap(nt, "apertura"); }
    if (k) { th.contatto = k.id; if (existing && !existing.contatto && cfg.mode === "demo") sources.demo.updateTicket(existing.id, { contatto: k.id }); }
    th.msgs.push({ k: "fwd", kind: b.kind, mailFrom: cm || undefined, contatto: k ? k.id : undefined, from: (k && k.n) || b.from || "", t: b.time || now(), text: b.body, lines: b.lines || null, photos: (b.files || []).length });
    if (b.note) th.msgs.push({ k: "me", t: now(), text: b.note });
    /* nessun messaggio di conferma: solo, per un ticket nuovo, il numero e il testo da girare al cliente */
    if (isNew && c && cfg.mode === "demo") th.msgs.push({ k: "tf", t: now(), text: "Nuovo ticket " + ticket + ".",
      forClient: tpl.render("testo_cliente", { nome: k ? String(k.n).split(" ")[0] : "", ticket }).testo.replace(/Buongiorno ,/, "Buongiorno,") });
    else if (!c) th.msgs.push({ k: "tf", t: now(), text: "Cliente da identificare: l'ufficio ti scrive qui appena lo trova." });
    store.save();
    res.json({ ticket, data: await appData(tech) });
  } catch (e) { next(e); }
});

app.post("/api/app/note", auth.requireTech, async (req, res, next) => {
  try {
    const st = store.load(), tech = req.tech, text = String(req.body.text || "").trim();
    const th = (st.threads[tech.mail] || []).find(t => t.ticket === req.body.ticket);
    const att = files.save(req.body.files);
    if (att.error) return res.status(400).json({ error: att.error });
    if (!th || (!text && !att.saved.length)) return res.status(400).json({ error: "conversazione o testo mancante" });
    const { tickets, clients } = await sources.data(); clientsCache = clients;
    const t = tickets.find(x => x.id === th.ticket);
    if (!th.contatto && t && t.contatto) th.contatto = t.contatto;
    /* se il cliente ha scritto per mail, la risposta del tecnico gli arriva in copia (si può togliere dall'app) */
    const cc = req.body.cc ? clientMailOf(th, st, tech) : "";
    const msg = mail.buildMessage({ tech, client: null, ticket: th.ticket, isNew: false, subject: "Re: " + th.ticket + (t ? " - " + t.title : ""), cc,
      text: text + (cc ? "\n\n" + tpl.render("firma_tecnico", { tecnico: tech.nome || tech.mail, ticket: th.ticket }).testo : "\n\n-- Nota del tecnico inviata con l'app Ticket Farm --"),
      inReplyTo: t ? (t.msgIds || []).slice(-1)[0] || "" : "", time: "", origin: cc ? "risposta del tecnico al cliente" : "nota del tecnico", files: att.mail });
    const sent = await mail.send(msg);
    await logMail(msg, sent);
    if (cc) audit.add(tech.mail, "Risposta al cliente dall'app", th.ticket + " · copia a " + cc, "app");
    th.msgs.push({ k: "me", t: now(), text, cc: cc || undefined, files: att.saved.length ? att.saved : undefined });
    /* nota interna: il cliente riceve solo l'avviso che c'è un aggiornamento (mai il testo); il messaggio al cliente gli arriva già in copia */
    if (!cc && t) await sendRecap(t, "messaggio", { chi: "Il tecnico" });
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
      const mm = tpl.render("reset_password", { nome: f.acc.nome || f.acc.user, link });
      await mail.send({ from: { name: "Ticket Farm", address: settings.support() }, to: f.acc.mail, subject: mm.oggetto, text: mm.testo });
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
app.get("/api/admin/file/:id", sendFile);
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
      const read = (inboxCache.list || []).map(m => ({ ...m, res: { ...recognize({ from: m.from, subject: m.subj, headers: m.hdr }, { techs: auth.techs(), clients, tickets, rules: st.rules, custom: st.customRules || [] }), act: "Letta dalla casella " + settings.graph().mailbox + " (Office 365)." } }));
      mails = [...read, ...st.mails.filter(x => !read.some(r => r.subj === x.subj && r.from === x.from))];
    }
    if (cfg.mode === "demo") {
      const extra = sources.demo.inbound.filter(m => !st.mails.some(x => x.id === m.id)).map(m => ({ ...m,
        res: { ...recognize({ from: m.from, subject: m.subj, headers: m.hdr }, { techs: auth.techs(), clients, tickets, rules: st.rules, custom: st.customRules || [] }), act: "Esempio di mail arrivata direttamente da un cliente." } }));
      mails = [...st.mails, ...extra];
    }
    /* conversazioni dei tecnici con Ticket Farm, ticket per ticket (in prova anche quelle di esempio non ancora aperte dall'app) */
    if (cfg.mode === "demo") for (const [m, list] of Object.entries(sources.demo.seedThreads)) if (!st.threads[m]) { st.threads[m] = JSON.parse(JSON.stringify(list)); store.save(); }
    const tl = auth.techs(), op = (req.admin.profilo || "admin") === "op";
    const threads = Object.entries(st.threads).flatMap(([m, list]) => { const t = tl.find(x => x.mail === m); return (list || []).map(th => ({ ...th, tech: t ? t.ini : "", techMail: m })); })
      .filter(th => !op || th.techMail === req.admin.mail);
    recap.checkInbound(mails);
    /* profilo Cliente: solo i ticket e l'anagrafica della propria azienda, niente posta né conversazioni interne */
    const mine = (req.admin.profilo || "admin") === "cliente" ? req.admin.cliente || "-" : "";
    const hidden = new Set(st.hiddenMails || []);
    mails = mails.filter(m => !hidden.has(m.id));
    if (mine) return res.json({ threads: [], ai: { enabled: false }, profiles: settings.profiles(), o365: null, settings: null, me: auth.publicAdmin(req.admin), mode: cfg.mode, support: "", appUrl: cfg.appUrl,
      clients: clients.filter(c => c.id === mine), tickets: tickets.filter(t => t.client === mine), techs: techsPublic().map(({ mail, ...t }) => ({ ...t, mail: "" })), mails: [], rules: [], customRules: [], aree: [], limiti: auth.limitInfo(), connections: [] });
    res.json({ recaps: recap.list().slice(0, 300), recapCfg: settings.recap(), recapMissing: recap.missing(clients, tickets), sistema: settings.sistema(), customRules: st.customRules || [], aree: settings.aree(), limiti: auth.limitInfo(), threads, ai: settings.aiPublic(), profiles: settings.profiles(), o365, settings: settings.can(req.admin.profilo || "admin", "office365", "v") ? settings.publicView() : null, me: auth.publicAdmin(req.admin), mode: cfg.mode, support: settings.support(), appUrl: cfg.appUrl, clients, tickets, techs: techsPublic(), mails, rules: st.rules, connections: await sources.status() });
  } catch (e) { next(e); }
});
/* l'ufficio scrive nella conversazione del tecnico: il messaggio arriva nell'app come «Ticket Farm» */
app.post("/api/admin/threads/reply", need("ticket", "m"), (req, res) => {
  const st = store.load(), text = String(req.body.text || "").trim().slice(0, 2000), m = String(req.body.techMail || "");
  const th = (st.threads[m] || []).find(t => t.ticket === req.body.ticket);
  const att = files.save(req.body.files);
  if (att.error) return res.status(400).json({ error: att.error });
  if (!th || (!text && !att.saved.length)) return res.status(400).json({ error: "conversazione o testo mancante" });
  const msg = { k: "tf", t: now(), text: text, by: req.admin.nome || req.admin.user || "Ufficio", id: "o" + Date.now().toString(36) };
  if (att.saved.length) msg.files = att.saved;
  if (req.body.forClient) msg.forClient = String(req.body.forClient).slice(0, 2000);
  th.msgs.push(msg); th.unread = true; store.save();
  log(req, "Messaggio al tecnico", th.ticket + " · " + m, "ticket");
  sources.data().then(d => { const t = d.tickets.find(x => x.id === th.ticket); if (t) return sendRecap(t, "messaggio", { chi: "L'ufficio" }); }).catch(() => {});
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
    if (ticket) { const nt = (await sources.data()).tickets.find(x => x.id === ticket); if (nt) await sendRecap(nt, "apertura"); }
    m.res = { ...(m.res || {}), state: "new", client: c.id, ticket, act: ticket ? "Aperto " + ticket + " per " + c.name + " (simulato)." : "Cliente indicato: " + c.name + ". Il ticket va aperto nel sistema dei ticket." };
    store.save();
    res.json({ ok: true, mail: m });
  } catch (e) { next(e); }
});
/* creare ed eliminare ticket: in prova sui dati di esempio; dal vivo vanno fatti in ITSM o Halo (da collegare) */
app.post("/api/admin/tickets", need("ticket", "m"), async (req, res, next) => {
  try {
    const { clients } = await sources.data();
    const own = req.admin.profilo === "cliente" ? req.admin.cliente : "";
    const c = clients.find(x => x.id === (own || req.body.client) && !x.eliminato), title = String(req.body.title || "").trim().slice(0, 120);
    if (!c || !title) return res.status(400).json({ error: "cliente o richiesta mancanti" });
    if (c.tipo === "fornitore") return res.status(400).json({ error: "i ticket si aprono per un cliente, non per un fornitore" });
    if (own) { req.body.tech = ""; req.body.fornitore = ""; if (!req.body.contatto) { const me = (c.contacts || []).find(x => x.mail && x.mail.toLowerCase() === String(req.admin.mail || "").toLowerCase()); if (me) req.body.contatto = me.id; } }
    if (req.body.tech && !auth.techs().some(t => t.ini === req.body.tech && t.attivo !== false && !t.eliminato)) return res.status(400).json({ error: "tecnico non attivo: scegline un altro" });
    if (cfg.mode !== "demo") return res.status(501).json({ error: "dal vivo il ticket va aperto nel sistema dei ticket collegato: collegamento non ancora disponibile" });
    const kk = (c.contacts || []).find(x => x.id === req.body.contatto), fo = clients.find(x => x.id === req.body.fornitore && x.tipo === "fornitore");
    const id = sources.demo.createTicket(c, title, String(req.body.tech || ""), { urg: !!req.body.urg, origin: own ? "Portale cliente" : "Console", contatto: kk ? kk.id : "", fornitore: fo ? fo.id : "" });
    log(req, "Ticket creato", id + " · " + c.name + " · " + title, "ticket");
    const nt = (await sources.data()).tickets.find(x => x.id === id); if (nt) await sendRecap(nt, "apertura");
    res.json({ ticket: { id, sys: c.sys, client: c.id, title } });
  } catch (e) { next(e); }
});
/* modificare un ticket: stato, tecnico, urgenza, data dell'intervento, richiesta */
app.put("/api/admin/tickets/:id", need("ticket", "m"), async (req, res, next) => {
  try {
  if (req.admin.profilo === "cliente") return res.status(403).json({ error: "il cliente apre ticket ma non li modifica" });
  if (cfg.mode !== "demo") return res.status(501).json({ error: "dal vivo il ticket si modifica nel sistema dei ticket collegato: collegamento non ancora disponibile" });
  const b = req.body || {};
  if (b.tech && !auth.techs().some(t => t.ini === b.tech && t.attivo !== false && !t.eliminato)) return res.status(400).json({ error: "tecnico non attivo: scegline un altro" });
  const { clients } = await sources.data(), cur = (await sources.data()).tickets.find(x => x.id === req.params.id);
  if (b.contatto && cur) { const az = clients.find(x => x.id === cur.client); if (!az || !(az.contacts || []).some(x => x.id === b.contatto)) return res.status(400).json({ error: "il contatto non è di questo cliente" }); }
  if (b.fornitore && !clients.some(x => x.id === b.fornitore && x.tipo === "fornitore")) return res.status(400).json({ error: "fornitore non valido" });
  const before = cur ? JSON.parse(JSON.stringify(cur)) : null;
  const t = sources.demo.updateTicket(req.params.id, b);
  if (!t) return res.status(404).json({ error: "ticket non trovato" });
  log(req, "Ticket modificato", t.id + " · " + t.state + (t.tech ? " · " + t.tech : ""), "ticket");
  /* ogni modifica delle proprietà arriva al cliente: chiusura, intervento o aggiornamento con l'elenco delle modifiche */
  if (before) {
    const plan = p => p ? recapWhen(p) : "da fissare", nm = id => { const k = contactOf(clients, id); return k ? k.n : "—"; }, az = id => (clients.find(x => x.id === id) || { name: "nessuno" }).name;
    const ch = [];
    if (before.state !== t.state) ch.push("• Stato: " + before.state + " → " + t.state);
    if (JSON.stringify(before.plan || null) !== JSON.stringify(t.plan || null)) ch.push("• Intervento: " + plan(before.plan) + " → " + plan(t.plan));
    if ((before.tech || "") !== (t.tech || "")) ch.push("• Tecnico: " + (techNameOf(before.tech) || "da assegnare") + " → " + (techNameOf(t.tech) || "da assegnare"));
    if (before.title !== t.title) ch.push("• Richiesta: " + t.title);
    if (!!before.urg !== !!t.urg) ch.push("• Urgenza: " + (t.urg ? "urgente" : "non urgente"));
    if ((before.contatto || "") !== (t.contatto || "")) ch.push("• Referente: " + nm(t.contatto));
    if ((before.fornitore || "") !== (t.fornitore || "")) ch.push("• Fornitore coinvolto: " + az(t.fornitore));
    const modifiche = ch.join("\n");
    if (t.state === "Chiuso" && before.state !== "Chiuso") await sendRecap(t, "chiusura", { modifiche });
    else if (JSON.stringify(before.plan || null) !== JSON.stringify(t.plan || null) && t.plan && t.state !== "Chiuso") await sendRecap(t, "intervento", { modifiche });
    else if (ch.length) await sendRecap(t, "aggiornamento", { modifiche });
  }
  res.json({ ticket: t });
  } catch (e) { next(e); }
});
app.delete("/api/admin/tickets/:id", need("ticket", "e"), (req, res) => {
  if (cfg.mode !== "demo") return res.status(501).json({ error: "dal vivo i ticket si chiudono in ITSM o Halo, non si eliminano da qui" });
  if (!sources.demo.deleteTicket(req.params.id)) return res.status(404).json({ error: "ticket non trovato" });
  log(req, "Ticket eliminato", req.params.id, "ticket");
  res.json({ ok: true });
});
/* clienti: in prova sui dati di esempio; dal vivo le anagrafiche si gestiscono in ITSM o Halo */
const cleanClient = b => ({ tipo: b.tipo === "fornitore" ? "fornitore" : "cliente", name: String(b.name || "").trim().slice(0, 120), city: String(b.city || "").slice(0, 60), sys: settings.sistema(),
  dom: String(b.dom || "").toLowerCase().replace(/^@/, "").slice(0, 120),
  contacts: (Array.isArray(b.contacts) ? b.contacts : []).slice(0, 20).map(k => ({ id: /^[\w-]{1,40}$/.test(k.id || "") ? k.id : "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), n: String(k.n || "").slice(0, 80), ruolo: String(k.ruolo || "").slice(0, 60), ...(k.eliminato ? { eliminato: String(k.eliminato).slice(0, 40) } : {}), mail: String(k.mail || "").slice(0, 120), tel: String(k.tel || "").slice(0, 30), src: k.src === "Halo" ? "Halo" : k.src === "O365" ? "O365" : "ITSM" })) });
const liveOnly = (res, what) => res.status(501).json({ error: "dal vivo " + what + " si gestiscono in ITSM o Halo: collegamento non ancora disponibile" });
app.post("/api/admin/clients", need("clienti", "m"), (req, res) => {
  if (cfg.mode !== "demo") return liveOnly(res, "i clienti");
  const c = cleanClient(req.body || {}); if (!c.name) return res.status(400).json({ error: "ragione sociale mancante" });
  const id = sources.demo.createClient(c); log(req, "Cliente creato", c.name, "clienti");
  res.json({ id });
});
app.put("/api/admin/clients/:id", need("clienti", "m"), (req, res) => {
  if (cfg.mode !== "demo") return liveOnly(res, "i clienti");
  if (req.body && req.body.ripristina) { if (!sources.demo.restoreClient(req.params.id)) return res.status(404).json({ error: "cliente non trovato" }); log(req, "Cliente ripristinato", req.params.id, "clienti"); return res.json({ ok: true }); }
  const c = cleanClient(req.body || {}); if (!c.name) return res.status(400).json({ error: "ragione sociale mancante" });
  if (req.body.attivo !== undefined) c.attivo = !!req.body.attivo;
  if (!sources.demo.updateClient(req.params.id, c)) return res.status(404).json({ error: "cliente non trovato" });
  log(req, "Cliente modificato", c.name + (c.attivo === false ? " · disattivato" : ""), "clienti");
  res.json({ ok: true });
});
app.delete("/api/admin/clients/:id", need("clienti", "e"), (req, res) => {
  if (cfg.mode !== "demo") return liveOnly(res, "i clienti");
  if (!sources.demo.deleteClient(req.params.id)) return res.status(404).json({ error: "cliente non trovato" });
  log(req, "Cliente eliminato", req.params.id, "clienti");
  res.json({ ok: true });
});
/* tecnici: account dell'app, gestiti qui (data/tecnici.json) anche dal vivo */
const errCode = r => r.limite ? 409 : r.vietato ? 403 : 400;
app.post("/api/admin/techs", need("tecnici", "m"), (req, res) => { const r = auth.addTech(req.body || {}); if (r.error) return res.status(errCode(r)).json(r); log(req, "Tecnico creato", r.tech.mail, "tecnici"); res.json(r); });
app.put("/api/admin/techs/:mail", need("tecnici", "m"), (req, res) => { const r = auth.editTech(req.params.mail, req.body || {}); if (r.error) return res.status(r.limite ? 409 : 400).json(r); log(req, r.code ? "Nuovo codice al tecnico" : req.body.ripristina ? "Tecnico ripristinato" : req.body.attivo === false ? "Tecnico disattivato" : req.body.attivo === true ? "Tecnico riattivato" : "Tecnico modificato", r.tech.mail, "tecnici"); res.json(r); });
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
app.post("/api/admin/users", need("utenti", "m"), (req, res) => { const r = auth.addUser(req.body || {}, req.admin); if (r.error) return res.status(errCode(r)).json(r); log(req, "Utente creato", r.user.user + " (" + r.user.profilo + ")", "utenti"); res.json(r); });
app.put("/api/admin/users/:user", need("utenti", "m"), (req, res) => { const r = auth.editUser(req.params.user, req.body || {}, req.admin); if (r.error) return res.status(errCode(r)).json(r); log(req, "Utente modificato", r.user.user + (req.body.password ? " · nuova password" : "") + (req.body.attivo === false ? " · disattivato" : ""), "utenti"); res.json(r); });
app.delete("/api/admin/users/:user", need("utenti", "e"), (req, res) => { const r = auth.removeUser(req.params.user, req.admin); if (r.error) return res.status(errCode(r)).json(r); log(req, "Utente eliminato", req.params.user, "utenti"); res.json(r); });
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
app.post("/api/admin/profiles/new", need("profili", "m"), (req, res) => { const r = settings.addProfile(req.body || {}); if (r.error) return res.status(400).json(r); log(req, "Profilo creato", req.body.nome, "profili"); res.json(r); });
app.put("/api/admin/profiles/:key", need("profili", "m"), (req, res) => { const r = settings.editProfile(req.params.key, req.body || {}); if (r.error) return res.status(400).json(r); log(req, "Profilo modificato", req.params.key, "profili"); res.json(r); });
app.delete("/api/admin/profiles/:key", need("profili", "e"), (req, res) => {
  const r = settings.removeProfile(req.params.key, auth.users().some(u => !u.eliminato && u.profilo === req.params.key));
  if (r.error) return res.status(400).json(r); log(req, "Profilo eliminato", req.params.key, "profili"); res.json(r);
});
/* modelli dei messaggi: tutti i testi delle mail e dei messaggi, modificabili */
app.get("/api/admin/templates", need("modelli", "v"), (req, res) => res.json({ modelli: tpl.all() }));
app.put("/api/admin/templates/:key", need("modelli", "m"), (req, res) => { const r = tpl.update(req.params.key, req.body || {}); if (r.error) return res.status(400).json(r); log(req, "Modello modificato", r.modello.nome, "modelli"); res.json(r); });
app.delete("/api/admin/templates/:key", need("modelli", "m"), (req, res) => { if (!tpl.DEFAULTS[req.params.key]) return res.status(404).json({ error: "modello non trovato" }); const r = tpl.reset(req.params.key); log(req, "Modello ripristinato", r.modello.nome, "modelli"); res.json(r); });
/* recap ai clienti: impostazioni, registro, invii manuali, prova, nuovi tentativi */
app.get("/api/admin/recap", need("recap", "v"), async (req, res, next) => { try { const { clients, tickets } = await sources.data(); res.json({ recap: settings.recap(), recaps: recap.list().slice(0, 500), missing: recap.missing(clients, tickets) }); } catch (e) { next(e); } });
app.post("/api/admin/recap/settings", need("recap", "m"), (req, res) => { const r = settings.updateRecap(req.body || {}); log(req, "Impostazioni dei recap", r.recap.attivo ? "attivi" : "spenti", "recap"); res.json(r); });
app.post("/api/admin/recap/ticket", need("recap", "m"), async (req, res, next) => {
  try { const { clients, tickets } = await sources.data(), t = tickets.find(x => x.id === req.body.ticket); if (!t) return res.status(404).json({ error: "ticket non trovato" });
    const kind = ["apertura", "intervento", "chiusura"].includes(req.body.kind) ? req.body.kind : (t.state === "Chiuso" ? "chiusura" : t.plan ? "intervento" : "apertura");
    const e = await recap.forTicket(t, clients, kind, techNameOf(t.tech), true); log(req, "Recap inviato a mano", t.id + " · " + e.stato, "recap"); res.json({ recap: e }); } catch (e) { next(e); } });
app.post("/api/admin/recap/settimanale", need("recap", "m"), async (req, res, next) => { try { const { clients, tickets } = await sources.data(); const out = await recap.weekly(clients, tickets); log(req, "Riepilogo settimanale inviato", out.length + " destinatari", "recap"); res.json({ inviati: out }); } catch (e) { next(e); } });
app.post("/api/admin/recap/test", need("recap", "m"), async (req, res, next) => { try { const r = await recap.test(String(req.body.to || "").trim()); if (r.error) return res.status(400).json(r); log(req, "Recap di prova", r.to + " · " + r.stato, "recap"); res.json({ recap: r }); } catch (e) { next(e); } });
app.post("/api/admin/recap/:id/riprova", need("recap", "m"), async (req, res, next) => { try { const { clients, tickets } = await sources.data(); const r = await recap.retry(clients, tickets, req.params.id); res.json({ recap: r[0] || null }); } catch (e) { next(e); } });
/* aree di lavoro */
/* sistema dei ticket in uso: i collegamenti sono alternativi (uno solo alla volta) */
app.post("/api/admin/sistema", need("collegamenti", "m"), (req, res) => { const r = settings.setSistema(req.body.sistema); if (r.error) return res.status(400).json(r); sources.invalidate(); log(req, "Sistema dei ticket in uso", r.sistema, "collegamenti"); res.json(r); });
app.get("/api/admin/aree", need("aree", "v"), (req, res) => res.json({ aree: settings.aree() }));
app.post("/api/admin/aree", need("aree", "m"), (req, res) => { const r = settings.addArea(req.body || {}); if (r.error) return res.status(400).json(r); log(req, "Area di lavoro creata", r.area.nome, "aree"); res.json(r); });
app.put("/api/admin/aree/:id", need("aree", "m"), (req, res) => { const r = settings.editArea(req.params.id, req.body || {}); if (r.error) return res.status(400).json(r); log(req, "Area di lavoro modificata", r.area.nome, "aree"); res.json(r); });
app.delete("/api/admin/aree/:id", need("aree", "e"), (req, res) => { const r = settings.removeArea(req.params.id); if (r.error) return res.status(404).json(r); log(req, "Area di lavoro eliminata", req.params.id, "aree"); res.json(r); });
/* limite di utenti attivi: lo vede chi gestisce gli utenti, lo cambia solo un amministratore */
app.get("/api/admin/limiti", need("utenti", "v"), (req, res) => res.json(auth.limitInfo()));
app.post("/api/admin/limiti", (req, res) => {
  if (req.admin.profilo !== "admin") return res.status(403).json({ error: "solo un amministratore cambia il limite di utenti" });
  const r = settings.updateLimiti(req.body || {}); if (r.error) return res.status(400).json(r);
  log(req, "Limite di utenti cambiato", r.limiti.maxUtenti ? String(r.limiti.maxUtenti) : "nessun limite", "utenti"); res.json(auth.limitInfo());
});
/* posta in arrivo: archiviare una mail (non si cancella dal server di posta, sparisce dall'elenco) */
app.delete("/api/admin/mails/:id", need("posta", "e"), (req, res) => {
  const st = store.load(); st.hiddenMails = st.hiddenMails || [];
  if (!st.hiddenMails.includes(req.params.id)) st.hiddenMails.push(req.params.id);
  store.save(); log(req, "Mail archiviata", req.params.id, "posta"); res.json({ ok: true });
});
/* conversazioni: l'ufficio ne apre una nuova con un tecnico, modifica o elimina i propri messaggi */
app.post("/api/admin/threads", need("ticket", "m"), async (req, res, next) => {
  try {
    const st = store.load(), m = String(req.body.techMail || ""), text = String(req.body.text || "").trim().slice(0, 2000);
    const tech = auth.techs().find(t => t.mail === m && t.attivo !== false && !t.eliminato);
    const { tickets } = await sources.data(); const t = tickets.find(x => x.id === req.body.ticket);
    if (!tech || !t || !text) return res.status(400).json({ error: "scegli ticket, tecnico attivo e scrivi il messaggio" });
    const list = st.threads[m] = st.threads[m] || [];
    let th = list.find(x => x.ticket === t.id);
    if (!th) { th = { ticket: t.id, client: t.client, contatto: t.contatto || "", unread: true, msgs: [] }; list.unshift(th); }
    const msg = { k: "tf", t: now(), text, by: req.admin.nome || req.admin.user, id: "o" + Date.now().toString(36) };
    th.msgs.push(msg); th.unread = true; store.save(); log(req, "Conversazione aperta con il tecnico", t.id + " · " + m, "ticket");
    await sendRecap(t, "messaggio", { chi: "L'ufficio" });
    res.json({ ok: true, msg });
  } catch (e) { next(e); }
});
const officeMsg = (st, b) => { const th = (st.threads[String(b.techMail || "")] || []).find(t => t.ticket === b.ticket); const m = th && th.msgs.find(x => x.id && x.id === b.id && x.k === "tf" && x.by); return { th, m }; };
app.put("/api/admin/threads/msg", need("ticket", "m"), (req, res) => {
  const st = store.load(), { m } = officeMsg(st, req.body || {}), text = String(req.body.text || "").trim().slice(0, 2000);
  if (!m || !text) return res.status(400).json({ error: "si modificano solo i messaggi dell'ufficio" });
  m.text = text; m.mod = now(); store.save(); log(req, "Messaggio al tecnico modificato", req.body.ticket, "ticket"); res.json({ ok: true, msg: m });
});
app.delete("/api/admin/threads/msg", need("ticket", "e"), (req, res) => {
  const st = store.load(), { th, m } = officeMsg(st, req.body || {});
  if (!m) return res.status(400).json({ error: "si eliminano solo i messaggi dell'ufficio" });
  th.msgs.splice(th.msgs.indexOf(m), 1); store.save(); log(req, "Messaggio al tecnico eliminato", req.body.ticket, "ticket"); res.json({ ok: true });
});
/* regole di riconoscimento aggiunte dall'ufficio */
const cleanRule = b => ({ tipo: b.tipo === "parola" ? "parola" : "dominio", valore: String(b.valore || "").trim().toLowerCase().replace(/^@/, "").slice(0, 80), cliente: String(b.cliente || ""), on: b.on !== false });
app.post("/api/admin/rules/custom", need("regole", "m"), (req, res) => {
  const st = store.load(), r = cleanRule(req.body || {}); if (!r.valore || !r.cliente) return res.status(400).json({ error: "scrivi il valore e scegli il cliente" });
  st.customRules = st.customRules || []; r.id = "r" + Date.now().toString(36); st.customRules.push(r); store.save();
  log(req, "Regola aggiunta", r.tipo + " " + r.valore, "regole"); res.json({ customRules: st.customRules });
});
app.put("/api/admin/rules/custom/:id", need("regole", "m"), (req, res) => {
  const st = store.load(), x = (st.customRules || []).find(y => y.id === req.params.id); if (!x) return res.status(404).json({ error: "regola non trovata" });
  const r = cleanRule({ ...x, ...req.body }); if (!r.valore || !r.cliente) return res.status(400).json({ error: "scrivi il valore e scegli il cliente" });
  Object.assign(x, r); store.save(); log(req, "Regola modificata", x.tipo + " " + x.valore, "regole"); res.json({ customRules: st.customRules });
});
app.delete("/api/admin/rules/custom/:id", need("regole", "e"), (req, res) => {
  const st = store.load(), i = (st.customRules || []).findIndex(y => y.id === req.params.id); if (i < 0) return res.status(404).json({ error: "regola non trovata" });
  const [x] = st.customRules.splice(i, 1); store.save(); log(req, "Regola eliminata", x.tipo + " " + x.valore, "regole"); res.json({ customRules: st.customRules });
});
app.post("/api/admin/rules", need("regole", "m"), (req, res) => {
  const st = store.load(); const r = st.rules.find(x => x.k === req.body.k);
  if (r) { r.on = !!req.body.on; store.save(); log(req, r.on ? "Regola attivata" : "Regola disattivata", r.t, "regole"); }
  res.json({ rules: st.rules, custom: st.customRules || [] });
});

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message || "errore del server" }); });

if (require.main === module) {
  /* recap: nuovi tentativi e riepilogo settimanale, controllati ogni 10 minuti */
  setInterval(() => recap.tick(sources.data).catch(e => console.error("recap", e.message)), 10 * 60000);
  app.listen(cfg.port, () => {
    console.log(`Ticket Farm backend su http://localhost:${cfg.port} (modalità ${cfg.mode})`);
    if (cfg.mode === "demo") console.log("Prova: accedi dall'app con mb@efuture.it e codice 123456. Le mail vanno in backend/outbox.");
    if (cfg.mode === "live" && !auth.techs().length) console.log("Attenzione: nessun tecnico. Aggiungili con: npm run codice -- mail@efuture.it \"Nome\" INI Zona");
    if (cfg.secret === "solo-per-prova") console.log("Attenzione: imposta SECRET in .env");
  });
}
module.exports = app;

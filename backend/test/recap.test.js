/* Recap ai clienti: partono al contatto del ticket, l'esito resta registrato, rimbalzi e mail mancanti sono visibili. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
process.env.MODE = "demo"; process.env.ADMIN_PASSWORD = "";
const cfg = require("../src/config");
const mail = require("../src/mail");
const recap = require("../src/recap");
const app = require("../server");

let srv, base, sent = [], reject = [];
/* server di posta finto: accetta tutti tranne gli indirizzi in «reject» */
mail.setTransport({ sendMail: async m => { sent.push(m); const to = String(m.to); return { messageId: "<id" + sent.length + "@test>", accepted: reject.includes(to) ? [] : [to], rejected: reject.includes(to) ? [to] : [], response: "250 OK" }; } });
const call = async (method, url, token, body) => {
  const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const login = async (u, p) => (await call("POST", "/api/admin/login", null, { user: u, password: p })).json.token;
test.before(() => new Promise(ok => { fs.rmSync(cfg.dataDir, { recursive: true, force: true }); srv = app.listen(0, () => { base = "http://127.0.0.1:" + srv.address().port; ok(); }); }));
test.after(() => { srv.close(); mail.setTransport(null); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); fs.rmSync(path.join(cfg.dataDir, "..", "outbox"), { recursive: true, force: true }); });

test("chiudere un ticket manda il recap alla persona che l'ha chiesto, con esito «accettata»", async () => {
  const ad = await login("admin", "admin123"); sent = [];
  const r = await call("PUT", "/api/admin/tickets/" + encodeURIComponent("Tck #714845"), ad, { state: "Chiuso" });
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1); assert.equal(sent[0].to, "c.lepori@pharmalab-mendrisio.ch");
  assert.match(sent[0].subject, /Tck #714845/); assert.match(sent[0].text, /Buongiorno Chiara/);
  assert.equal(sent[0].headers["Disposition-Notification-To"], "support@efuture.it", "chiede la conferma di lettura");
  const e = (await call("GET", "/api/admin/recap", ad)).json.recaps.find(x => x.ticket === "Tck #714845");
  assert.equal(e.stato, "accettata"); assert.equal(e.kind, "chiusura");
});

test("fissare l'intervento manda il recap; contatto senza mail resta segnalato", async () => {
  const ad = await login("admin", "admin123"); sent = [];
  await call("PUT", "/api/admin/tickets/" + encodeURIComponent("Tck #714848"), ad, { plan: { day: 1, time: "09:00" }, state: "Pianificato" });
  const rs = (await call("GET", "/api/admin/recap", ad)).json;
  const e = rs.recaps.find(x => x.ticket === "Tck #714848");
  assert.equal(e.stato, "manca la mail"); assert.equal(sent.length, 0);
  assert.ok(rs.missing.some(m => m.nome === "Elisa Rota"), "la console sa chi non riceverà i recap");
});

test("rifiutata dal server: si vede e si riprova; un avviso di mancata consegna la segna «non consegnata»", async () => {
  const ad = await login("admin", "admin123");
  reject = ["s.guidotti@acqualuganese.ch"];
  const r = await call("POST", "/api/admin/recap/ticket", ad, { ticket: "Tck #714842" });
  assert.equal(r.json.recap.stato, "rifiutata");
  reject = [];
  const again = await call("POST", "/api/admin/recap/" + r.json.recap.id + "/riprova", ad);
  assert.equal(again.json.recap.stato, "accettata"); assert.equal(again.json.recap.tentativi, 2);
  const changed = recap.checkInbound([{ subj: "Non recapitabile: " + again.json.recap.subj, body: "Message-ID: " + again.json.recap.messageId, hdr: [] }]);
  assert.equal(changed, 1);
  assert.equal(recap.list().find(x => x.id === again.json.recap.id).stato, "non consegnata");
});

test("riepilogo settimanale: una mail per persona con le sue richieste aperte", async () => {
  const ad = await login("admin", "admin123"); sent = [];
  const r = await call("POST", "/api/admin/recap/settimanale", ad);
  assert.ok(r.json.inviati.length >= 5);
  const pha = sent.find(m => m.to === "m.ferrari@pharmalab-mendrisio.ch");
  assert.ok(pha && /Tck #714846/.test(pha.text));
  assert.ok(r.json.inviati.some(e => e.stato === "manca la mail"));
});

test("ogni modifica delle proprietà arriva al cliente con l'elenco delle modifiche", async () => {
  const ad = await login("admin", "admin123"); sent = [];
  await call("PUT", "/api/admin/tickets/" + encodeURIComponent("Tck #714844"), ad, { tech: "MB", urg: true });
  assert.equal(sent.length, 1); assert.equal(sent[0].to, "i.bassi@tlr-bellinzona.ch");
  assert.match(sent[0].subject, /aggiornamento/); assert.match(sent[0].text, /Tecnico: .* → /); assert.match(sent[0].text, /Urgenza: urgente/);
});

test("nota interna del tecnico: il cliente riceve l'avviso ma mai il testo della nota", async () => {
  sent = [];
  const tok = (await call("POST", "/api/app/login", null, { mail: "mb@efuture.it", code: "123456" })).json.token;
  await call("GET", "/api/app/data", tok);   /* come l'app all'apertura: prepara le conversazioni */
  await call("POST", "/api/app/note", tok, { ticket: "Tck #714139", text: "Il cliente è un po' difficile, portare il kit completo", cc: false });
  const toClient = sent.filter(m => m.to === "m.rossi@caseificiovalle.ch");
  assert.equal(toClient.length, 1); assert.match(toClient[0].text, /Il tecnico ha aggiunto un aggiornamento/);
  assert.doesNotMatch(toClient[0].text, /difficile/);
});

test("i modelli dei messaggi si modificano e la mail usa il nuovo testo; si ripristinano", async () => {
  const ad = await login("admin", "admin123"); sent = [];
  const m = (await call("GET", "/api/admin/templates", ad)).json.modelli;
  assert.ok(m.apertura && m.firma && m.codice_app && m.reset_password && m.testo_cliente);
  assert.equal((await call("PUT", "/api/admin/templates/apertura", ad, { oggetto: "Presa in carico {ticket}", testo: "Gentile {nome}, ricevuta.\n{firma}" })).status, 200);
  await call("PUT", "/api/admin/templates/firma", ad, { testo: "Il team Swan Service" });
  await call("POST", "/api/admin/tickets", ad, { client: "pha", title: "Prova modello", contatto: "pha-1" });
  const mm = sent.find(x => /Presa in carico Tck/.test(x.subject));
  assert.ok(mm, "oggetto dal modello"); assert.match(mm.text, /Gentile Chiara, ricevuta\.\nIl team Swan Service/);
  assert.equal((await call("PUT", "/api/admin/templates/apertura", ad, { oggetto: "", testo: "x" })).status, 400);
  const r = await call("DELETE", "/api/admin/templates/apertura", ad);
  assert.equal(r.json.modello.modificato, false);
});

/* Recupero password, verifica in due passaggi, codici di recupero, nuovo codice ai tecnici, opzioni passkey. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
process.env.MODE = "demo"; process.env.ADMIN_PASSWORD = "";
const cfg = require("../src/config");
const totp = require("../src/totp");
const app = require("../server");
let srv, base;
const call = async (method, url, token, body) => {
  const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
test.before(() => new Promise(ok => { fs.rmSync(cfg.dataDir, { recursive: true, force: true }); srv = app.listen(0, () => { base = "http://127.0.0.1:" + srv.address().port; ok(); }); }));
test.after(() => { srv.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); fs.rmSync(path.join(cfg.dataDir, "..", "outbox"), { recursive: true, force: true }); });

test("TOTP: vettore di prova della RFC 6238 e tolleranza di 30 secondi", () => {
  const key = Buffer.from("12345678901234567890");
  assert.equal(totp.hotp(key, Math.floor(59 / 30), 8), "94287082");
  const s = totp.b32encode(key);
  assert.ok(totp.verify(s, totp.code(s, 1e12), 1e12));
  assert.ok(totp.verify(s, totp.code(s, 1e12 - 30000), 1e12));
  assert.ok(!totp.verify(s, totp.code(s, 1e12 - 90000), 1e12));
  assert.ok(!totp.verify(s, "abc123"));
});

test("password dimenticata: link usa e getta, poi la nuova password funziona", async () => {
  const f = await call("POST", "/api/admin/forgot", null, { user: "l.bianchi" });
  assert.equal(f.status, 200); assert.match(f.json.demoLink, /#reset=/);
  const none = await call("POST", "/api/admin/forgot", null, { user: "non-esiste" });
  assert.equal(none.json.message, f.json.message, "la risposta non rivela se l'utente esiste");
  const token = f.json.demoLink.split("#reset=")[1];
  assert.equal((await call("POST", "/api/admin/reset", null, { token, password: "corta" })).status, 400);
  assert.equal((await call("POST", "/api/admin/reset", null, { token, password: "NuovaPassword9" })).status, 200);
  assert.equal((await call("POST", "/api/admin/reset", null, { token, password: "AltraPassword9" })).status, 400, "il link vale una volta");
  assert.ok((await call("POST", "/api/admin/login", null, { user: "l.bianchi", password: "NuovaPassword9" })).json.token);
  assert.ok(fs.readdirSync(path.join(cfg.dataDir, "..", "outbox")).length >= 1, "la mail è stata preparata");
});

test("verifica in due passaggi: attivazione, accesso con codice e con codice di recupero", async () => {
  const t0 = (await call("POST", "/api/admin/login", null, { user: "admin", password: "admin123" })).json.token;
  const st = await call("POST", "/api/admin/2fa/setup", t0);
  assert.match(st.json.uri, /^otpauth:\/\/totp\/Ticket%20Farm%3Aadmin\?secret=/);
  assert.equal((await call("POST", "/api/admin/2fa/enable", t0, { code: "000000" })).status, 400);
  const en = await call("POST", "/api/admin/2fa/enable", t0, { code: totp.code(st.json.secret) });
  assert.equal(en.status, 200); assert.equal(en.json.recovery.length, 8); assert.equal(en.json.me.twofa, true);
  const step1 = await call("POST", "/api/admin/login", null, { user: "admin", password: "admin123" });
  assert.equal(step1.json.need2fa, true); assert.equal(step1.json.token, undefined);
  assert.equal((await call("POST", "/api/admin/login/2fa", null, { ticket: step1.json.ticket, code: "123456" })).status, 401);
  assert.ok((await call("POST", "/api/admin/login/2fa", null, { ticket: step1.json.ticket, code: totp.code(st.json.secret) })).json.token);
  const rec = await call("POST", "/api/admin/login/2fa", null, { ticket: step1.json.ticket, code: en.json.recovery[0] });
  assert.equal(rec.json.usedRecovery, true); assert.equal(rec.json.left, 7);
  assert.equal((await call("POST", "/api/admin/login/2fa", null, { ticket: step1.json.ticket, code: en.json.recovery[0] })).status, 401, "un codice di recupero vale una volta");
  const t1 = rec.json.token;
  assert.equal((await call("POST", "/api/admin/2fa/disable", t1, { password: "admin123", code: totp.code(st.json.secret) })).status, 200);
  assert.ok((await call("POST", "/api/admin/login", null, { user: "admin", password: "admin123" })).json.token);
});

test("app: codice dimenticato genera un nuovo codice e quello vecchio smette di funzionare", async () => {
  const r = await call("POST", "/api/app/forgot", null, { mail: "lc@efuture.it" });
  assert.match(r.json.demoCode, /^\d{6}$/);
  assert.equal((await call("POST", "/api/app/login", null, { mail: "lc@efuture.it", code: "123456" })).status, 401);
  assert.equal((await call("POST", "/api/app/login", null, { mail: "lc@efuture.it", code: r.json.demoCode })).status, 200);
});

test("passkey: opzioni di registrazione e di accesso", async () => {
  const t = (await call("POST", "/api/admin/login", null, { user: "g.verdi", password: "admin123" })).json.token;
  const reg = await call("POST", "/api/admin/passkey/register/options", t);
  assert.equal(reg.json.rp.name, "Ticket Farm"); assert.equal(reg.json.user.name, "g.verdi"); assert.ok(reg.json.challenge);
  const lo = await call("POST", "/api/admin/passkey/login/options", null);
  assert.ok(lo.json.challenge);
  assert.equal((await call("POST", "/api/admin/passkey/login/verify", null, { response: { id: "sconosciuta", response: {} } })).status, 401);
});

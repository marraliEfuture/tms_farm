/* Utenti, profili e permessi della console, registro attività e backup (backend in prova). */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
process.env.MODE = "demo"; process.env.ADMIN_PASSWORD = "";
const cfg = require("../src/config");
const app = require("../server");

let srv, base;
const call = async (method, url, token, body) => {
  const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const login = async (user, password) => (await call("POST", "/api/admin/login", null, { user, password })).json.token;

test.before(() => new Promise(ok => { fs.rmSync(cfg.dataDir, { recursive: true, force: true }); srv = app.listen(0, () => { base = "http://127.0.0.1:" + srv.address().port; ok(); }); }));
test.after(() => { srv.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); fs.rmSync(path.join(cfg.dataDir, "..", "outbox"), { recursive: true, force: true }); });

test("l'operatore crea ticket ma non li elimina e non vede il registro", async () => {
  const op = await login("g.verdi", "admin123");
  assert.ok(op);
  const st = await call("GET", "/api/admin/state", op);
  assert.equal(st.status, 200); assert.equal(st.json.me.profilo, "op"); assert.equal(st.json.settings, null);
  const t = await call("POST", "/api/admin/tickets", op, { client: "cas", title: "Prova operatore" });
  assert.equal(t.status, 200);
  assert.equal((await call("DELETE", "/api/admin/tickets/" + encodeURIComponent(t.json.ticket.id), op)).status, 403);
  assert.equal((await call("GET", "/api/admin/audit", op)).status, 403);
  assert.equal((await call("GET", "/api/admin/backup", op)).status, 403);
});

test("l'amministratore gestisce utenti, vede il registro e fa backup e ripristino", async () => {
  const ad = await login("admin", "admin123");
  const u = await call("POST", "/api/admin/users", ad, { user: "m.neri", nome: "Mario Neri", profilo: "resp", password: "Password123" });
  assert.equal(u.status, 200);
  assert.equal((await call("POST", "/api/admin/users", ad, { user: "corta", profilo: "op", password: "x" })).status, 400);
  assert.equal((await call("PUT", "/api/admin/users/admin", ad, { profilo: "op" })).status, 400, "serve almeno un amministratore");
  const resp = await login("m.neri", "Password123");
  assert.equal((await call("GET", "/api/admin/audit", resp)).status, 200, "il responsabile vede il registro");
  assert.equal((await call("POST", "/api/admin/users", resp, { user: "x.y", profilo: "op", password: "Password123" })).status, 403, "ma non crea utenti");
  const log = (await call("GET", "/api/admin/audit", ad)).json.entries.map(e => e.azione);
  assert.ok(log.includes("Utente creato") && log.includes("Ticket creato") && log.includes("Accesso alla console"));
  const bk = await call("GET", "/api/admin/backup", ad);
  assert.equal(bk.json.app, "Ticket Farm"); assert.ok(bk.json.files["users.json"].some(x => x.user === "m.neri"));
  await call("DELETE", "/api/admin/users/m.neri", ad);
  assert.equal((await call("POST", "/api/admin/restore", ad, bk.json)).status, 200);
  assert.ok((await call("GET", "/api/admin/users", ad)).json.users.some(x => x.user === "m.neri"), "il ripristino riporta l'utente");
});

test("i permessi dei profili si cambiano, ma l'amministratore resta completo", async () => {
  const ad = await login("admin", "admin123");
  const r = await call("POST", "/api/admin/profiles", ad, { op: { cruscotto: "v", posta: "vm", ticket: "vme", clienti: "v", tutorial: "v" }, admin: { ticket: "" } });
  assert.equal(r.json.profiles.op.perm.ticket, "vme");
  assert.equal(r.json.profiles.admin.perm.ticket, "vme");
});

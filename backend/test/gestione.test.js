/* Profili Agente e Cliente, amministratori protetti, limite di utenti, storico dopo disattivazione/eliminazione, aree di lavoro, modifica ticket. */
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

test("profili: amministratore, responsabile, agente, tecnico, cliente", async () => {
  const ad = await login("admin", "admin123");
  const p = (await call("GET", "/api/admin/state", ad)).json.profiles;
  assert.deepEqual(["admin", "resp", "agent", "op", "cliente"].filter(k => p[k]).length, 5);
  const n = await call("POST", "/api/admin/profiles/new", ad, { nome: "Magazzino", base: "agent" });
  assert.equal(n.status, 200); assert.equal(n.json.profiles[n.json.key].perm.posta, "vm");
  assert.equal((await call("DELETE", "/api/admin/profiles/resp", ad)).status, 400, "i profili di base restano");
  assert.equal((await call("DELETE", "/api/admin/profiles/" + n.json.key, ad)).status, 200);
});

test("il cliente vede solo i ticket della sua azienda e non li modifica", async () => {
  const cli = await login("m.rossi", "admin123");
  const st = (await call("GET", "/api/admin/state", cli)).json;
  assert.ok(st.tickets.length > 0 && st.tickets.every(t => t.client === "cas"));
  assert.equal(st.mails.length, 0); assert.equal(st.threads.length, 0);
  const t = await call("POST", "/api/admin/tickets", cli, { client: "vin", title: "Bilancia ferma" });
  assert.equal(t.status, 200); assert.equal(t.json.ticket.client, "cas", "apre ticket solo per la sua azienda");
  assert.equal((await call("PUT", "/api/admin/tickets/" + encodeURIComponent(t.json.ticket.id), cli, { state: "Chiuso" })).status, 403);
});

test("solo un amministratore modifica o elimina un amministratore", async () => {
  const ad = await login("admin", "admin123"), resp = await login("l.bianchi", "admin123");
  await call("POST", "/api/admin/profiles", ad, { resp: { utenti: "vme", cruscotto: "v" } });
  assert.equal((await call("PUT", "/api/admin/users/admin", resp, { nome: "X" })).status, 403);
  assert.equal((await call("DELETE", "/api/admin/users/admin", resp)).status, 403);
  assert.equal((await call("PUT", "/api/admin/users/g.verdi", resp, { profilo: "admin" })).status, 403, "né promuove ad amministratore");
  assert.equal((await call("PUT", "/api/admin/users/g.verdi", resp, { nome: "Giulia V." })).status, 200);
});

test("limite di utenti attivi: oltre il limite non si crea né si riattiva", async () => {
  const ad = await login("admin", "admin123");
  const n = (await call("GET", "/api/admin/limiti", ad)).json.attivi;
  assert.equal((await call("POST", "/api/admin/limiti", ad, { maxUtenti: n })).status, 200);
  const u = await call("POST", "/api/admin/users", ad, { user: "z.extra", profilo: "op", password: "Password123" });
  assert.equal(u.status, 409); assert.match(u.json.error, /Limite di utenti raggiunto/);
  assert.equal((await call("POST", "/api/admin/techs", ad, { mail: "zz@efuture.it", nome: "Zeta" })).status, 409);
  await call("PUT", "/api/admin/users/g.verdi", ad, { attivo: false });
  assert.equal((await call("POST", "/api/admin/users", ad, { user: "z.extra", profilo: "op", password: "Password123" })).status, 200, "liberato un posto");
  assert.equal((await call("PUT", "/api/admin/users/g.verdi", ad, { attivo: true })).status, 409, "riattivare conta");
  await call("POST", "/api/admin/limiti", ad, { maxUtenti: 0 });
});

test("disattivato o eliminato: non entra più, ma ticket e conversazioni restano", async () => {
  const ad = await login("admin", "admin123");
  const app1 = await call("POST", "/api/app/login", null, { mail: "mb@efuture.it", code: "123456" });
  assert.equal(app1.status, 200);
  await call("PUT", "/api/admin/techs/mb%40efuture.it", ad, { attivo: false });
  assert.equal((await call("POST", "/api/app/login", null, { mail: "mb@efuture.it", code: "123456" })).status, 401);
  assert.equal((await call("GET", "/api/app/data", app1.json.token)).status, 401, "la sessione già aperta si chiude");
  await call("DELETE", "/api/admin/techs/mb%40efuture.it", ad);
  const st = (await call("GET", "/api/admin/state", ad)).json;
  assert.ok(st.tickets.some(t => t.tech === "MB"), "i ticket tengono il tecnico");
  const mb = st.techs.find(t => t.ini === "MB"); assert.ok(mb && mb.eliminato && !mb.attivo, "nome e iniziali restano nello storico");
  assert.ok(st.threads.some(th => th.tech === "MB"), "le conversazioni restano");
  await call("DELETE", "/api/admin/clients/far", ad);
  const st2 = (await call("GET", "/api/admin/state", ad)).json;
  assert.ok(st2.clients.find(c => c.id === "far").eliminato); assert.ok(st2.tickets.some(t => t.client === "far"));
  assert.equal((await call("PUT", "/api/admin/techs/mb%40efuture.it", ad, { ripristina: true })).status, 200);
});

test("aree di lavoro: crea, assegna a tecnici e agenti, modifica, elimina", async () => {
  const ad = await login("admin", "admin123");
  const a = await call("POST", "/api/admin/aree", ad, { nome: "Ticino Sud", colore: "#22aa66" });
  assert.equal(a.status, 200); const id = a.json.area.id;
  assert.deepEqual((await call("PUT", "/api/admin/techs/lc%40efuture.it", ad, { aree: [id, "inesistente"] })).json.tech.aree, [id]);
  assert.deepEqual((await call("PUT", "/api/admin/users/a.neri", ad, { aree: [id] })).json.user.aree, [id]);
  assert.equal((await call("PUT", "/api/admin/aree/" + id, ad, { nome: "Sottoceneri" })).json.area.nome, "Sottoceneri");
  assert.equal((await call("DELETE", "/api/admin/aree/" + id, ad)).status, 200);
  assert.ok((await call("GET", "/api/admin/aree", ad)).json.aree.find(x => x.id === id).eliminato);
});

test("ticket: modifica di stato, tecnico e data; un tecnico disattivato non si assegna", async () => {
  const ad = await login("admin", "admin123");
  const r = await call("PUT", "/api/admin/tickets/HALO-4812", ad, { state: "Pianificato", tech: "LC", plan: { day: 2, time: "10:30" } });
  assert.equal(r.status, 200); assert.equal(r.json.ticket.tech, "LC"); assert.deepEqual(r.json.ticket.plan, { day: 2, time: "10:30" });
  await call("PUT", "/api/admin/techs/gn%40efuture.it", ad, { attivo: false });
  assert.equal((await call("PUT", "/api/admin/tickets/HALO-4812", ad, { tech: "GN" })).status, 400);
});

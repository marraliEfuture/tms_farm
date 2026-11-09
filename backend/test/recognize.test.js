const test = require("node:test");
const assert = require("node:assert");
const { recognize } = require("../src/recognize");
const demo = require("../src/connectors/demo");
const { DEFAULT_RULES } = require("../src/store");

const ctx = async () => ({ techs: [{ mail: "mb@efuture.it" }], clients: await demo.clients(), tickets: await demo.tickets(), rules: DEFAULT_RULES });

test("risposta dell'app su ticket ITSM: riconosciuta da In-Reply-To e oggetto", async () => {
  const r = recognize({ from: "mb@efuture.it", subject: "Re: Tck #714139 - Analizzatore latte",
    headers: [["In-Reply-To", "<Ws7WB6YiYyB2lUu50cay1nFeKHjUiw5YWv2h8WHnx4T@itsm.efuture.it>"]] }, await ctx());
  assert.equal(r.state, "ok"); assert.equal(r.ticket, "Tck #714139"); assert.equal(r.client, "cas");
  assert.deepEqual(r.how, ["tech", "reply", "subj"]);
});
test("nuova richiesta dall'app: cliente dall'intestazione", async () => {
  const r = recognize({ from: "mb@efuture.it", subject: "Messaggio WhatsApp - Acque Lario Sagl", headers: [["X-TicketFarm-Cliente-Id", "acq"]] }, await ctx());
  assert.equal(r.state, "new"); assert.equal(r.client, "acq");
});
test("mail di un cliente sconosciuto: da verificare", async () => {
  const r = recognize({ from: "info@nuovolab.ch", subject: "Preventivo", headers: [] }, await ctx());
  assert.equal(r.state, "warn");
});
test("dominio del mittente", async () => {
  const r = recognize({ from: "altro@caseificiovalle.ch", subject: "Ciao", headers: [] }, await ctx());
  assert.equal(r.client, "cas"); assert.deepEqual(r.how, ["dom"]);
});
test("regola disattivata non viene usata", async () => {
  const c = await ctx(); c.rules = DEFAULT_RULES.map(r => ({ ...r, on: r.k !== "dom" }));
  const r = recognize({ from: "altro@caseificiovalle.ch", subject: "Ciao", headers: [] }, c);
  assert.equal(r.state, "warn");
});

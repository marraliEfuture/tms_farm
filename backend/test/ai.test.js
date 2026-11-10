/* Assistente AI: richiesta a Claude (simulata con un client finto), dati inviati, rifiuti e ripieghi. */
const test = require("node:test");
const assert = require("node:assert");
const ai = require("../src/ai");
const demo = require("../src/connectors/demo");

const input = async () => ({ tech: { ini: "MB", nome: "Tecnico Zona Sud", zona: "Sud" }, clients: await demo.clients(),
  tickets: (await demo.tickets()).filter(t => t.tech === "MB" && t.state !== "Chiuso"), date: "martedì 10 novembre 2026" });

test("invia a Claude solo i dati dei ticket e legge la risposta strutturata", async () => {
  let sent = null;
  ai.setClientFactory(() => ({ beta: { messages: { parse: async p => { sent = p; return {
    stop_reason: "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 900, output_tokens: 300 },
    parsed_output: { promemoria: "Prima chiama il Caseificio.", attivita: [{ ticket: "Tck #714139", perche: "Urgente." }, { ticket: "INVENTATO-1", perche: "x" }] } }; } } } }));
  const r = await ai.agenda(await input(), { fresh: true });
  assert.equal(r.source, "claude"); assert.equal(r.text, "Prima chiama il Caseificio.");
  assert.deepEqual(r.order.map(x => x.ticket), ["Tck #714139"], "i ticket inventati vengono scartati");
  assert.equal(sent.model, "claude-opus-5-5"); assert.equal(sent.fallbacks, "default"); assert.equal(sent.output_config.effort, "low");
  assert.equal(sent.output_config.format.type, "json_schema");
  const txt = sent.messages[0].content;
  assert.match(txt, /Tck #714139 · Caseificio Valle SA \(Mendrisio\)/); assert.match(txt, /oggi alle 14:00/);
  assert.doesNotMatch(txt, /@|\+41/, "niente mail né telefoni");
});
test("se Claude rifiuta, l'errore è chiaro", async () => {
  ai.setClientFactory(() => ({ beta: { messages: { parse: async () => ({ stop_reason: "refusal", stop_details: { category: "cyber" }, usage: {} }) } } }));
  await assert.rejects(ai.agenda(await input(), { fresh: true }), /rifiutato.*cyber/);
});
test("la simulazione mette prima l'urgenza e spiega il perché", async () => {
  const r = ai.simulate(await input());
  assert.equal(r.source, "simulazione"); assert.equal(r.order[0].ticket, "Tck #714139"); assert.match(r.order[0].perche, /Urgente/);
  assert.match(r.text, /Caseificio Valle SA/);
});
test("stima del costo mensile", () => {
  assert.ok(ai.monthlyCost("claude-opus-5-5", 10, 22) > ai.monthlyCost("claude-haiku-5-5", 10, 22));
  assert.equal(ai.monthlyCost("claude-opus-5-5", 1, 1).toFixed(4), ((1800 * 4 + 700 * 20) / 1e6).toFixed(4));
});

test("suggerimenti per il responsabile: urgenza, ticket senza tecnico, posta", async () => {
  const clients = await demo.clients(), tickets = (await demo.tickets()).filter(t => t.state !== "Chiuso");
  const r = ai.simulateTeam({ tickets, clients, techs: [{ ini: "MB", zona: "Sud" }, { ini: "LC", zona: "Centro" }], toCheck: 2 });
  assert.equal(r.tips[0].ticket, "Tck #714139");
  assert.ok(r.tips.some(x => /Assegna HALO-4812 a LC/.test(x.titolo)));
  assert.ok(r.tips.some(x => /Verifica 2 mail/.test(x.titolo)));
  assert.match(ai.teamText({ tickets, clients, techs: [{ ini: "MB" }], toCheck: 2, date: "oggi" }), /tecnico: nessuno/);
});

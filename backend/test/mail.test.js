const test = require("node:test");
const assert = require("node:assert");
const nodemailer = require("nodemailer");
const mail = require("../src/mail");

const tech = { mail: "mb@efuture.it", nome: "Tecnico Zona Sud" };
async function raw(msg) { const t = nodemailer.createTransport({ streamTransport: true, buffer: true }); return (await t.sendMail(msg)).message.toString(); }

test("ticket esistente: oggetto Re: Tck e In-Reply-To come le risposte dei clienti", async () => {
  const id = "<Ws7WB6YiYyB2lUu50cay1nFeKHjUiw5YWv2h8WHnx4T@itsm.efuture.it>";
  const m = mail.buildMessage({ tech, client: null, ticket: "Tck #714139", isNew: false, subject: "Re: Tck #714139 - Analizzatore", text: "ciao", inReplyTo: id, time: "9/11/2026 07:51", origin: "WhatsApp del tecnico" });
  const s = await raw(m);
  assert.match(s, /^From: Tecnico Zona Sud <mb@efuture.it>/m);
  assert.match(s, /^Subject: Re: Tck #714139 - Analizzatore/m);
  assert.ok(s.includes("In-Reply-To: " + id)); assert.ok(s.includes("References: " + id));
  assert.match(s, /^X-TicketFarm-Ora-Messaggio: 9\/11\/2026 07:51/mi);
  assert.doesNotMatch(s, /X-TicketFarm-Cliente:/i);
});
test("nuova richiesta: niente In-Reply-To, cliente nelle intestazioni, foto allegata", async () => {
  const m = mail.buildMessage({ tech, client: { id: "acq", name: "Acque Lario Sagl" }, ticket: "", isNew: true, subject: "Messaggio WhatsApp - Acque Lario Sagl",
    text: "testo", time: "", origin: "WhatsApp del tecnico", files: [{ name: "foto.jpg", type: "image/jpeg", data: Buffer.from("x").toString("base64") }] });
  const s = await raw(m);
  assert.doesNotMatch(s, /In-Reply-To/);
  assert.match(s, /^X-TicketFarm-Cliente: Acque Lario Sagl/mi);
  assert.match(s, /^X-TicketFarm-Cliente-Id: acq/mi);
  assert.match(s, /filename=foto.jpg/);
});
test("testo della mail: WhatsApp con ora per riga e nota del tecnico", () => {
  const t = mail.bodyText({ kind: "wa", from: "Marco Rossi", time: "9/11/2026 07:51", lines: [{ time: "07:51", text: "ciao" }], note: "passo io" });
  assert.match(t, /WhatsApp del cliente Marco Rossi, ricevuto 9\/11\/2026 07:51/);
  assert.match(t, /\[07:51\] ciao/); assert.match(t, /Nota del tecnico --\npasso io/);
});

test("risposta del tecnico a un cliente che ha scritto per mail: cliente in copia, ufficio in A", async () => {
  const m = mail.buildMessage({ tech, client: null, ticket: "HALO-4821", isNew: false, subject: "Re: HALO-4821 - Spettrofotometro", text: "Passo domani alle 9.",
    inReplyTo: "<p8Hh2kQmL0aZ1x@halo.efuture.it>", time: "", origin: "risposta del tecnico al cliente", cc: "g.bernasconi@laboratorioesempio.ch" });
  const s = await raw(m);
  assert.match(s, /^To: support@/m);
  assert.match(s, /^Cc: g\.bernasconi@laboratorioesempio\.ch/m);
  assert.match(s, /^Subject: Re: HALO-4821/m);
  const n = await raw(mail.buildMessage({ tech, client: null, ticket: "HALO-4821", isNew: false, subject: "Re: HALO-4821", text: "nota", origin: "nota del tecnico" }));
  assert.doesNotMatch(n, /^Cc:/m);
});

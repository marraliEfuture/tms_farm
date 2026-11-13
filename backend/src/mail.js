/* Costruisce e spedisce la mail verso support@ nello stesso formato delle risposte dei clienti:
   - ticket esistente: "Re: Tck #714139 - titolo" + In-Reply-To/References = ultima mail del ticket
   - richiesta nuova: prima mail senza riferimenti, il cliente è nelle intestazioni X-TicketFarm-* */
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const cfg = require("./config");
const settings = require("./settings");

let transport = null;
function getTransport() {
  if (transport) return transport;
  if (cfg.smtp.host) {
    transport = nodemailer.createTransport({ host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.secure,
      auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined });
  } else {
    /* senza SMTP: la mail viene scritta come file .eml in backend/outbox */
    transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  }
  return transport;
}

function buildMessage(o) {
  const headers = {
    "X-TicketFarm-Tecnico": o.tech.mail,
    "X-TicketFarm-Ora-Messaggio": o.time || "",
    "X-TicketFarm-Origine": o.origin,
  };
  if (!o.ticket || o.isNew) {
    headers["X-TicketFarm-Cliente"] = o.client ? o.client.name : "da identificare";
    if (o.client) headers["X-TicketFarm-Cliente-Id"] = o.client.id;
  }
  const msg = {
    from: { name: o.tech.nome || o.tech.mail, address: o.tech.mail },
    to: settings.support(),
    subject: o.subject,
    text: o.text,
    headers,
    attachments: (o.files || []).filter(f => f && f.data).map(f => ({ filename: f.name || "foto.jpg", content: Buffer.from(f.data, "base64"), contentType: f.type || "image/jpeg" })),
  };
  /* risposta a un cliente che ha scritto per mail: gli arriva in copia, l'ufficio resta in «A» */
  if (o.cc) { msg.cc = o.cc; headers["X-TicketFarm-Copia-Cliente"] = o.cc; }
  if (o.inReplyTo) { msg.inReplyTo = o.inReplyTo; msg.references = [o.inReplyTo]; }
  return msg;
}

async function send(msg) {
  const info = await getTransport().sendMail(msg);
  let file = "";
  if (info.message) {
    fs.mkdirSync(cfg.outboxDir, { recursive: true });
    file = path.join(cfg.outboxDir, new Date().toISOString().replace(/[:.]/g, "-") + ".eml");
    fs.writeFileSync(file, info.message);
  }
  /* accepted/rejected: cosa ha detto il server di posta per ogni destinatario */
  return { messageId: info.messageId, file, real: !!cfg.smtp.host || !!testTransport, accepted: (info.accepted || []).map(String), rejected: (info.rejected || []).map(String), response: info.response || "" };
}
/* solo per i test: un trasporto finto che accetta o rifiuta */
let testTransport = null;
function setTransport(t) { testTransport = t; transport = t; }

/* testo leggibile della mail: il messaggio del cliente, poi l'eventuale nota del tecnico */
function bodyText(o) {
  const head = o.kind === "mail"
    ? `Mail del cliente${o.mailFrom ? " (" + o.mailFrom + ")" : ""}, ricevuta ${o.time} sulla casella personale del tecnico.`
    : `Messaggio WhatsApp del cliente${o.from ? " " + o.from : ""}, ricevuto ${o.time} sul numero personale del tecnico.`;
  const lines = o.lines && o.lines.length ? o.lines.map(l => (l.time ? "[" + l.time + "] " : "") + l.text).join("\n") : o.body;
  return head + "\n\n" + lines + (o.note ? "\n\n-- Nota del tecnico --\n" + o.note : "") + "\n\nInviato con l'app Ticket Farm.";
}
module.exports = { buildMessage, send, bodyText, setTransport };

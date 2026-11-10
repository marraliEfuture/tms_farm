/* Dati di esempio: gli stessi del prototipo. Usati con MODE=demo. */
const CLIENTS = [
  { id: "lab", lat: 46.0037, lng: 8.9511, name: "Laboratorio Esempio SA", city: "Lugano", sys: "Halo", dom: "laboratorioesempio.ch", contacts: [{ n: "Giulia Bernasconi", src: "Halo", mail: "g.bernasconi@laboratorioesempio.ch", tel: "+41 79 410 22 18" }] },
  { id: "cas", lat: 45.8706, lng: 8.9817, name: "Caseificio Valle SA", city: "Mendrisio", sys: "ITSM", dom: "caseificiovalle.ch", contacts: [{ n: "Marco Rossi", src: "O365", mail: "m.rossi@caseificiovalle.ch", tel: "+41 78 655 01 90" }] },
  { id: "acq", lat: 45.834, lng: 9.03, name: "Acque Lario Sagl", city: "Chiasso", sys: "Halo", dom: "acquelario.ch", contacts: [{ n: "Sara Fontana", src: "O365", mail: "s.fontana@acquelario.ch", tel: "" }] },
  { id: "alp", lat: 46.1946, lng: 9.0244, name: "Labor Alpina SA", city: "Bellinzona", sys: "ITSM", dom: "laboralpina.ch", contacts: [{ n: "Luca Pedrazzini", src: "ITSM", mail: "l.pedrazzini@laboralpina.ch", tel: "+41 79 233 87 12" }] },
  { id: "che", lat: 46.0937, lng: 8.918, name: "Chemlab Ticino Sagl", city: "Mezzovico", sys: "ITSM", dom: "chemlab-ticino.ch", contacts: [{ n: "Anna Croci", src: "ITSM", mail: "a.croci@chemlab-ticino.ch", tel: "+41 76 118 40 27" }] },
  { id: "far", lat: 46.1709, lng: 8.7995, name: "Farmacia Centrale Locarno", city: "Locarno", sys: "Halo", dom: "farmaciacentrale-locarno.ch", contacts: [{ n: "Elena Mariotta", src: "Halo", mail: "e.mariotta@farmaciacentrale-locarno.ch", tel: "+41 79 512 66 03" }] },
  { id: "vin", lat: 46.059, lng: 8.931, name: "Vini Collina SA", city: "Taverne", sys: "Halo", dom: "vinicollina.ch", contacts: [{ n: "Paolo Ghirlanda", src: "O365", mail: "p.ghirlanda@vinicollina.ch", tel: "+41 76 300 14 59" }] },
];
const dago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const TICKETS = [
  { id: "Tck #714139", opened: dago(0), plan: null, sys: "ITSM", client: "cas", title: "Analizzatore latte: letture instabili", state: "In lavorazione", tech: "MB", urg: true, origin: "ITSM", upd: "08:20", msgIds: ["<Ws7WB6YiYyB2lUu50cay1nFeKHjUiw5YWv2h8WHnx4T@itsm.efuture.it>"] },
  { id: "Tck #714133", opened: dago(6), plan: { day: 0, time: "14:00" }, sys: "ITSM", client: "che", title: "Titolatore: taratura annuale", state: "Pianificato", tech: "MB", origin: "ITSM", upd: "ieri", msgIds: ["<Qa1KfP0nBv7cX2mL9sR4tY6uW8zE3hJ5dG0iO1pN2qM@itsm.efuture.it>"] },
  { id: "Tck #714128", opened: dago(12), plan: null, sys: "ITSM", client: "alp", title: "HPLC: manutenzione ordinaria", state: "Chiuso", tech: "LC", origin: "Mail cliente", upd: "ven", msgIds: [] },
  { id: "HALO-4821", opened: dago(1), plan: { day: 1, time: "09:00" }, sys: "Halo", client: "lab", title: "Spettrofotometro: errore lampada", state: "Pianificato", tech: "MB", origin: "WhatsApp tecnico", upd: "07:40", msgIds: ["<p8Hh2kQmL0aZ1x@halo.efuture.it>"] },
  { id: "HALO-4799", opened: dago(9), plan: null, sys: "Halo", client: "far", title: "Bilancia analitica: guasto", state: "In attesa ricambio", tech: "MB", origin: "Telefono", upd: "ven", msgIds: ["<r2Df9sLw0Pq4@halo.efuture.it>"] },
  { id: "HALO-4812", opened: dago(1), sys: "Halo", client: "vin", title: "Ordine reagenti e agenti", state: "Aperto", tech: "", origin: "Mail cliente", upd: "ieri", msgIds: [] },
  { id: "Tck #714136", opened: dago(3), plan: null, sys: "ITSM", client: "alp", title: "Centrifuga: vibrazioni anomale", state: "In lavorazione", tech: "LC", origin: "Telefono", upd: "09:05", msgIds: [] },
  { id: "HALO-4806", opened: dago(5), plan: null, sys: "Halo", client: "acq", title: "pH-metro: calibrazione", state: "In attesa cliente", tech: "GN", origin: "Mail cliente", upd: "lun", msgIds: [] },
  { id: "Tck #714121", opened: dago(24), plan: null, sys: "ITSM", client: "che", title: "Bilancia di precisione: verifica metrica", state: "Chiuso", tech: "MB", origin: "ITSM", upd: "21/10", msgIds: [] },
];
const THREADS_MB = [
  { ticket: "HALO-4821", client: "lab", clientMail: "g.bernasconi@laboratorioesempio.ch", unread: true, msgs: [
    { k: "fwd", from: "Giulia Bernasconi", t: "ieri 18:05", text: "Buonasera, lo spettrofotometro dà di nuovo errore lampada all'accensione." },
    { k: "tf", t: "07:40", text: "La cliente chiede un passaggio domani mattina: fissato alle 9:00.",
      forClient: "Buongiorno, confermo il passaggio domani alle 9:00 per lo spettrofotometro (pratica HALO-4821). Buona giornata." } ] },
  { ticket: "Tck #714139", client: "cas", unread: true, msgs: [
    { k: "tf", t: "07:55", text: "Nuovo ticket assegnato a te: analizzatore latte con letture instabili. Urgente." } ] },
  { ticket: "HALO-4799", client: "far", unread: false, msgs: [
    { k: "me", t: "ven 16:20", text: "Serve la cella di carico, l'ho segnata nel rapporto." } ] },
];
const INBOUND = [
  { id: "d3", at: "07:40", from: "g.bernasconi@laboratorioesempio.ch", fromName: "Giulia Bernasconi", subj: "Re: HALO-4821 - Spettrofotometro: errore lampada",
    hdr: [["In-Reply-To", "<p8Hh2kQmL0aZ1x@halo.efuture.it>"]], body: "Buongiorno, è possibile un passaggio domani mattina? Grazie." },
  { id: "d5", at: "07:02", from: "info@nuovolab.ch", fromName: "Nuovo Lab Sagl", subj: "Richiesta preventivo manutenzione", hdr: [],
    body: "Buongiorno, vorremmo un preventivo per la manutenzione annuale di due centrifughe." },
];

let seq = 30;
module.exports = {
  name: "demo",
  async clients() { return CLIENTS; },
  async tickets() { return TICKETS; },
  async status() {
    return [
      { n: "ITSM", how: "Dati di esempio", what: "Ticket e clienti", sync: "modalità prova", ok: true },
      { n: "Halo", how: "Dati di esempio", what: "Ticket e clienti", sync: "modalità prova", ok: true },
      { n: "Office 365", how: "Dati di esempio", what: "Contatti", sync: "modalità prova", ok: true },
    ];
  },
  /* solo in prova: simula il ticket che ITSM o Halo aprirebbero alla prima mail */
  createTicket(client, title, techIni, opts) {
    opts = opts || {};
    seq++;
    const id = client.sys === "Halo" ? "HALO-48" + seq : "Tck #7142" + seq;
    TICKETS.unshift({ id, opened: dago(0), sys: client.sys, client: client.id, title, state: "Aperto", tech: techIni || "", urg: !!opts.urg, origin: opts.origin || "App tecnico", upd: "adesso", msgIds: [] });
    return id;
  },
  createClient(c) { const id = "c" + Date.now().toString(36); CLIENTS.push({ id, ...c }); return id; },
  updateClient(id, c) { const x = CLIENTS.find(y => y.id === id); if (!x) return false; Object.assign(x, c); return true; },
  deleteClient(id) { const i = CLIENTS.findIndex(y => y.id === id); if (i < 0) return false; CLIENTS.splice(i, 1); return true; },
  deleteTicket(id) {
    const i = TICKETS.findIndex(t => t.id === id);
    if (i < 0) return false;
    TICKETS.splice(i, 1);
    return true;
  },
  seedThreads: { "mb@efuture.it": THREADS_MB },
  inbound: INBOUND,
};

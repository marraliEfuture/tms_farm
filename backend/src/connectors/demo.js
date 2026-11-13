/* Dati di esempio: gli stessi del prototipo. Usati con MODE=demo. */
/* aziende: tipo «cliente» o «fornitore»; ogni azienda ha i suoi contatti (persone) con un id */
const CLIENTS = [
  { id: "lab", tipo: "cliente", lat: 46.0037, lng: 8.9511, name: "Laboratorio Esempio SA", city: "Lugano", sys: "ITSM", dom: "laboratorioesempio.ch", contacts: [
    { id: "lab-1", n: "Giulia Bernasconi", ruolo: "Responsabile laboratorio", src: "ITSM", mail: "g.bernasconi@laboratorioesempio.ch", tel: "+41 79 410 22 18" },
    { id: "lab-2", n: "Davide Rezzonico", ruolo: "Acquisti", src: "O365", mail: "d.rezzonico@laboratorioesempio.ch", tel: "+41 91 600 12 40" }] },
  { id: "cas", tipo: "cliente", lat: 45.8706, lng: 8.9817, name: "Caseificio Valle SA", city: "Mendrisio", sys: "ITSM", dom: "caseificiovalle.ch", contacts: [
    { id: "cas-1", n: "Marco Rossi", ruolo: "Titolare", src: "O365", mail: "m.rossi@caseificiovalle.ch", tel: "+41 78 655 01 90" },
    { id: "cas-2", n: "Lucia Rossi", ruolo: "Amministrazione", src: "ITSM", mail: "l.rossi@caseificiovalle.ch", tel: "" }] },
  { id: "acq", tipo: "cliente", lat: 45.834, lng: 9.03, name: "Acque Lario Sagl", city: "Chiasso", sys: "ITSM", dom: "acquelario.ch", contacts: [{ id: "acq-1", n: "Sara Fontana", ruolo: "Qualità", src: "O365", mail: "s.fontana@acquelario.ch", tel: "" }] },
  { id: "alp", tipo: "cliente", lat: 46.1946, lng: 9.0244, name: "Labor Alpina SA", city: "Bellinzona", sys: "ITSM", dom: "laboralpina.ch", contacts: [{ id: "alp-1", n: "Luca Pedrazzini", ruolo: "Capo laboratorio", src: "ITSM", mail: "l.pedrazzini@laboralpina.ch", tel: "+41 79 233 87 12" }] },
  { id: "che", tipo: "cliente", lat: 46.0937, lng: 8.918, name: "Chemlab Ticino Sagl", city: "Mezzovico", sys: "ITSM", dom: "chemlab-ticino.ch", contacts: [{ id: "che-1", n: "Anna Croci", ruolo: "Responsabile qualità", src: "ITSM", mail: "a.croci@chemlab-ticino.ch", tel: "+41 76 118 40 27" }] },
  { id: "far", tipo: "cliente", lat: 46.1709, lng: 8.7995, name: "Farmacia Centrale Locarno", city: "Locarno", sys: "ITSM", dom: "farmaciacentrale-locarno.ch", contacts: [{ id: "far-1", n: "Elena Mariotta", ruolo: "Farmacista titolare", src: "ITSM", mail: "e.mariotta@farmaciacentrale-locarno.ch", tel: "+41 79 512 66 03" }] },
  { id: "vin", tipo: "cliente", lat: 46.059, lng: 8.931, name: "Vini Collina SA", city: "Taverne", sys: "ITSM", dom: "vinicollina.ch", contacts: [{ id: "vin-1", n: "Paolo Ghirlanda", ruolo: "Cantina", src: "O365", mail: "p.ghirlanda@vinicollina.ch", tel: "+41 76 300 14 59" }] },
  {"id": "cen", "tipo": "cliente", "lat": 46.378, "lng": 8.906, "name": "Termocentrale Leventina SA", "city": "Bodio", "sys": "ITSM", "dom": "termoleventina.ch", "contacts": [{"id": "cen-1", "n": "Fabio Martinoli", "ruolo": "Capo turno chimica", "src": "ITSM", "mail": "f.martinoli@termoleventina.ch", "tel": "+41 91 873 40 10"}, {"id": "cen-2", "n": "Nadia Pedrini", "ruolo": "Responsabile manutenzione", "src": "O365", "mail": "n.pedrini@termoleventina.ch", "tel": "+41 79 640 18 22"}]},
  {"id": "acl", "tipo": "cliente", "lat": 46.012, "lng": 8.952, "name": "Consorzio Acqua Potabile Luganese", "city": "Lugano", "sys": "ITSM", "dom": "acqualuganese.ch", "contacts": [{"id": "acl-1", "n": "Silvia Guidotti", "ruolo": "Responsabile qualità acqua", "src": "ITSM", "mail": "s.guidotti@acqualuganese.ch", "tel": "+41 91 800 77 31"}]},
  {"id": "tlr", "tipo": "cliente", "lat": 46.19, "lng": 9.015, "name": "Teleriscaldamento Bellinzona SA", "city": "Bellinzona", "sys": "ITSM", "dom": "tlr-bellinzona.ch", "contacts": [{"id": "tlr-1", "n": "Ivan Bassi", "ruolo": "Manutenzione impianti", "src": "ITSM", "mail": "i.bassi@tlr-bellinzona.ch", "tel": "+41 79 455 61 03"}]},
  {"id": "pha", "tipo": "cliente", "lat": 45.877, "lng": 8.976, "name": "Pharmalab Mendrisio SA", "city": "Mendrisio", "sys": "ITSM", "dom": "pharmalab-mendrisio.ch", "contacts": [{"id": "pha-1", "n": "Chiara Lepori", "ruolo": "QA acqua purificata", "src": "ITSM", "mail": "c.lepori@pharmalab-mendrisio.ch", "tel": "+41 91 640 22 90"}, {"id": "pha-2", "n": "Mattia Ferrari", "ruolo": "Utilities", "src": "O365", "mail": "m.ferrari@pharmalab-mendrisio.ch", "tel": "+41 79 302 55 14"}]},
  {"id": "sem", "tipo": "cliente", "lat": 46.032, "lng": 8.921, "name": "Microchip Ticino SA", "city": "Manno", "sys": "ITSM", "dom": "microchip-ticino.ch", "contacts": [{"id": "sem-1", "n": "Roberto Pini", "ruolo": "Impianto acqua ultrapura", "src": "ITSM", "mail": "r.pini@microchip-ticino.ch", "tel": "+41 91 610 88 40"}]},
  {"id": "dep", "tipo": "cliente", "lat": 45.972, "lng": 8.931, "name": "Depuratore Consortile Pian Scairolo", "city": "Grancia", "sys": "ITSM", "dom": "cdpianscairolo.ch", "contacts": [{"id": "dep-1", "n": "Elisa Rota", "ruolo": "Capo impianto", "src": "ITSM", "mail": "", "tel": "+41 79 512 40 77"}]},
  { id: "sta", tipo: "fornitore", name: "Strumenti Analitici SA", city: "Manno", sys: "ITSM", dom: "strumentianalitici.ch", contacts: [
    { id: "sta-1", n: "Pietro Galli", ruolo: "Ufficio ricambi", src: "ITSM", mail: "p.galli@strumentianalitici.ch", tel: "+41 91 610 55 20" },
    { id: "sta-2", n: "Chiara Fumagalli", ruolo: "Assistenza tecnica", src: "ITSM", mail: "c.fumagalli@strumentianalitici.ch", tel: "+41 79 880 41 07" }] },
  { id: "lmp", tipo: "fornitore", name: "LabLamp Sagl", city: "Lugano", sys: "ITSM", dom: "lablamp.ch", contacts: [{ id: "lmp-1", n: "Nicola Bianchi", ruolo: "Vendite", src: "O365", mail: "n.bianchi@lablamp.ch", tel: "+41 91 922 30 11" }] },
];
const dago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const TICKETS = [
  { id: "Tck #714139", contatto: "cas-1", opened: dago(0), plan: null, sys: "ITSM", client: "cas", title: "Analizzatore latte: letture instabili", state: "In lavorazione", tech: "MB", urg: true, origin: "Mail cliente", upd: "08:20", msgIds: ["<Ws7WB6YiYyB2lUu50cay1nFeKHjUiw5YWv2h8WHnx4T@itsm.efuture.it>"] },
  { id: "Tck #714133", contatto: "che-1", opened: dago(6), plan: { day: 0, time: "14:00" }, sys: "ITSM", client: "che", title: "Titolatore: taratura annuale", state: "Pianificato", tech: "MB", origin: "Mail cliente", upd: "ieri", msgIds: ["<Qa1KfP0nBv7cX2mL9sR4tY6uW8zE3hJ5dG0iO1pN2qM@itsm.efuture.it>"] },
  { id: "Tck #714128", contatto: "alp-1", opened: dago(12), plan: null, sys: "ITSM", client: "alp", title: "HPLC: manutenzione ordinaria", state: "Chiuso", tech: "LC", origin: "Mail cliente", upd: "ven", msgIds: [] },
  { id: "Tck #714821", contatto: "lab-1", opened: dago(1), plan: { day: 1, time: "09:00" }, sys: "ITSM", client: "lab", title: "Spettrofotometro: errore lampada", state: "Pianificato", tech: "MB", origin: "WhatsApp tecnico", upd: "07:40", msgIds: ["<p8Hh2kQmL0aZ1x@itsm.efuture.it>"] },
  { id: "Tck #714799", contatto: "far-1", fornitore: "sta", opened: dago(9), plan: null, sys: "ITSM", client: "far", title: "Bilancia analitica: guasto", state: "In attesa ricambio", tech: "MB", origin: "Telefono", upd: "ven", msgIds: ["<r2Df9sLw0Pq4@itsm.efuture.it>"] },
  { id: "Tck #714812", contatto: "vin-1", opened: dago(1), sys: "ITSM", client: "vin", title: "Ordine reagenti e agenti", state: "Aperto", tech: "", origin: "Mail cliente", upd: "ieri", msgIds: [] },
  { id: "Tck #714136", contatto: "alp-1", opened: dago(3), plan: null, sys: "ITSM", client: "alp", title: "Centrifuga: vibrazioni anomale", state: "In lavorazione", tech: "LC", origin: "Telefono", upd: "09:05", msgIds: [] },
  { id: "Tck #714806", contatto: "acq-1", opened: dago(5), plan: null, sys: "ITSM", client: "acq", title: "pH-metro: calibrazione", state: "In attesa cliente", tech: "GN", origin: "Mail cliente", upd: "lun", msgIds: [] },
  { id: "Tck #714121", contatto: "che-1", opened: dago(24), plan: null, sys: "ITSM", client: "che", title: "Bilancia di precisione: verifica metrica", state: "Chiuso", tech: "MB", origin: "Mail cliente", upd: "21/10", msgIds: [] },
  {"opened":dago(0),"id": "Tck #714840", "contatto": "cen-1", "plan": null, "client": "cen", "title": "Analizzatore di silice: valori fuori scala sul vapore surriscaldato", "state": "Aperto", "tech": "MB", "urg": true, "origin": "Telefono", "upd": "07:15", "sys": "ITSM", "msgIds": []},
  {"opened":dago(2),"id": "Tck #714841", "contatto": "cen-2", "plan": {"day": 2, "time": "08:30"}, "client": "cen", "title": "Conducibilità acqua alimento caldaia: deriva della cella", "state": "Pianificato", "tech": "MB", "origin": "Mail cliente", "upd": "ieri", "sys": "ITSM", "msgIds": []},
  {"opened":dago(4),"id": "Tck #714842", "contatto": "acl-1", "plan": null, "client": "acl", "title": "Cloro libero: sensore amperometrico da sostituire", "state": "In lavorazione", "tech": "LC", "origin": "WhatsApp tecnico", "upd": "08:40", "sys": "ITSM", "msgIds": []},
  {"opened":dago(1),"id": "Tck #714843", "contatto": "acl-1", "plan": null, "client": "acl", "title": "Torbidimetro rete idrica: allarme pulizia", "state": "Aperto", "tech": "GN", "origin": "Mail cliente", "upd": "ieri", "sys": "ITSM", "msgIds": []},
  {"opened":dago(7),"id": "Tck #714844", "contatto": "tlr-1", "plan": {"day": 5, "time": "10:00"}, "client": "tlr", "title": "Ossigeno disciolto: manutenzione annuale degli analizzatori", "state": "Pianificato", "tech": "LC", "origin": "Mail cliente", "upd": "lun", "sys": "ITSM", "msgIds": []},
  {"opened":dago(3),"id": "Tck #714845", "contatto": "pha-1", "plan": {"day": 1, "time": "13:30"}, "client": "pha", "title": "TOC acqua purificata: verifica di idoneità in scadenza", "state": "Pianificato", "tech": "MB", "origin": "Mail cliente", "upd": "ieri", "sys": "ITSM", "msgIds": []},
  {"opened":dago(6),"id": "Tck #714846", "contatto": "pha-2", "plan": null, "client": "pha", "title": "Conducibilità acqua per iniettabili: certificato di taratura", "state": "In attesa cliente", "tech": "MB", "origin": "Telefono", "upd": "mar", "sys": "ITSM", "msgIds": []},
  {"opened":dago(5),"id": "Tck #714847", "contatto": "sem-1", "fornitore": "sta", "plan": null, "client": "sem", "title": "Monitor di sodio acqua ultrapura: reagente in esaurimento", "state": "In attesa ricambio", "tech": "MB", "origin": "Mail cliente", "upd": "lun", "sys": "ITSM", "msgIds": []},
  {"opened":dago(0),"id": "Tck #714848", "contatto": "dep-1", "plan": null, "client": "dep", "title": "Analizzatore ammonio allo scarico: letture instabili", "state": "Aperto", "tech": "", "urg": true, "origin": "Telefono", "upd": "09:10", "sys": "ITSM", "msgIds": []},
  {"opened":dago(15),"id": "Tck #714849", "contatto": "tlr-1", "plan": null, "client": "tlr", "title": "pH acqua di reintegro: sostituzione elettrodo", "state": "Chiuso", "tech": "LC", "origin": "Mail cliente", "upd": "02/11", "sys": "ITSM", "msgIds": []},
  {"opened":dago(20),"id": "Tck #714850", "contatto": "dep-1", "plan": null, "client": "dep", "title": "Fosfato: formazione degli operatori", "state": "Chiuso", "tech": "GN", "origin": "Console", "upd": "28/10", "sys": "ITSM", "msgIds": []}
];
const THREADS_MB = [
  { ticket: "Tck #714821", contatto: "lab-1", client: "lab", clientMail: "g.bernasconi@laboratorioesempio.ch", unread: true, msgs: [
    { k: "fwd", from: "Giulia Bernasconi", t: "ieri 18:05", text: "Buonasera, lo spettrofotometro dà di nuovo errore lampada all'accensione." },
    { k: "tf", t: "07:40", text: "La cliente chiede un passaggio domani mattina: fissato alle 9:00.",
      forClient: "Buongiorno, confermo il passaggio domani alle 9:00 per lo spettrofotometro (pratica Tck #714821). Buona giornata." } ] },
  { ticket: "Tck #714139", contatto: "cas-1", client: "cas", unread: true, msgs: [
    { k: "tf", t: "07:55", text: "Nuovo ticket assegnato a te: analizzatore latte con letture instabili. Urgente." } ] },
  { ticket: "Tck #714799", contatto: "far-1", client: "far", unread: false, msgs: [
    { k: "me", t: "ven 16:20", text: "Serve la cella di carico, l'ho segnata nel rapporto." } ] },
];
const INBOUND = [
  { id: "d3", at: "07:40", from: "g.bernasconi@laboratorioesempio.ch", fromName: "Giulia Bernasconi", subj: "Re: Tck #714821 - Spettrofotometro: errore lampada",
    hdr: [["In-Reply-To", "<p8Hh2kQmL0aZ1x@itsm.efuture.it>"]], body: "Buongiorno, è possibile un passaggio domani mattina? Grazie." },
  { id: "d5", at: "07:02", from: "info@nuovolab.ch", fromName: "Nuovo Lab Sagl", subj: "Richiesta preventivo manutenzione", hdr: [],
    body: "Buongiorno, vorremmo un preventivo per la manutenzione annuale di due centrifughe." },
];

let seq = 30;
module.exports = {
  name: "demo",
  async clients() { return CLIENTS; },
  async tickets() { return TICKETS; },
  async status() {
    const sys = require("../settings").sistema();
    return [
      { n: "ITSM", how: "Dati di esempio", what: "Ticket e clienti", sync: "modalità prova", ok: true, inUso: sys === "ITSM" },
      { n: "Halo", how: "Dati di esempio", what: "Ticket e clienti", sync: "modalità prova", ok: true, inUso: sys === "Halo" },
      { n: "Office 365", how: "Dati di esempio", what: "Posta e contatti", sync: "modalità prova", ok: true },
    ];
  },
  /* solo in prova: simula il ticket che ITSM o Halo aprirebbero alla prima mail */
  createTicket(client, title, techIni, opts) {
    /* opts.contatto: la persona che ha chiesto; opts.fornitore: azienda fornitrice coinvolta */
    opts = opts || {};
    seq++;
    const id = "Tck #7148" + seq;
    TICKETS.unshift({ id, opened: dago(0), contatto: opts.contatto || "", fornitore: opts.fornitore || "", sys: client.sys, client: client.id, title, state: "Aperto", tech: techIni || "", urg: !!opts.urg, origin: opts.origin || "App tecnico", upd: "adesso", msgIds: [] });
    return id;
  },
  createClient(c) { const id = "c" + Date.now().toString(36); CLIENTS.push({ id, ...c }); return id; },
  updateClient(id, c) { const x = CLIENTS.find(y => y.id === id); if (!x) return false; Object.assign(x, c); return true; },
  /* eliminato: sparisce dagli elenchi ma resta sui ticket (storico) */
  deleteClient(id) { const x = CLIENTS.find(y => y.id === id && !y.eliminato); if (!x) return false; x.eliminato = new Date().toISOString(); x.attivo = false; return true; },
  restoreClient(id) { const x = CLIENTS.find(y => y.id === id); if (!x) return false; delete x.eliminato; x.attivo = true; return true; },
  updateTicket(id, b) {
    const t = TICKETS.find(x => x.id === id); if (!t) return null;
    if (b.title !== undefined) t.title = String(b.title).slice(0, 120);
    if (b.state !== undefined && ["Aperto", "In lavorazione", "Pianificato", "In attesa cliente", "In attesa ricambio", "Chiuso"].includes(b.state)) t.state = b.state;
    if (b.tech !== undefined) t.tech = String(b.tech).slice(0, 3);
    if (b.urg !== undefined) t.urg = !!b.urg;
    if (b.contatto !== undefined) t.contatto = String(b.contatto || "");
    if (b.fornitore !== undefined) t.fornitore = String(b.fornitore || "");
    if (b.plan !== undefined) t.plan = b.plan && /^\d{2}:\d{2}$/.test(b.plan.time || "") ? { day: Math.max(0, Math.min(60, Number(b.plan.day) || 0)), time: b.plan.time } : null;
    t.upd = "adesso"; return t;
  },
  deleteTicket(id) {
    const i = TICKETS.findIndex(t => t.id === id);
    if (i < 0) return false;
    TICKETS.splice(i, 1);
    return true;
  },
  seedThreads: { "mb@efuture.it": THREADS_MB },
  inbound: INBOUND,
};

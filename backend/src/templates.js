/* Modelli dei messaggi: tutti i testi che il sistema manda o propone, modificabili da Configurazione.
   Nei testi si usano i segnaposto tra graffe, sostituiti al momento dell'invio. */
const fs = require("fs");
const path = require("path");
const cfg = require("./config");

const FILE = path.join(cfg.dataDir, "templates.json");
/* chi: a chi va; quando: cosa lo fa partire; campi: segnaposto disponibili */
const DEFAULTS = {
  firma: { gruppo: "Comune", nome: "Firma in fondo alle mail ai clienti", chi: "Clienti", quando: "In tutte le mail ai clienti, al posto di {firma}", campi: [],
    testo: "Cordiali saluti\nAssistenza tecnica" },
  apertura: { gruppo: "Mail ai clienti", nome: "Presa in carico", chi: "La persona che ha chiesto", quando: "Appena si apre un nuovo ticket (console, app, portale, posta)",
    campi: ["nome", "azienda", "ticket", "titolo", "stato", "intervento", "tecnico", "firma"],
    oggetto: "{ticket} - {titolo}: abbiamo preso in carico la sua richiesta",
    testo: "Buongiorno {nome},\n\nabbiamo ricevuto la sua richiesta e l'abbiamo registrata con il numero {ticket}.\n\nRichiesta: {titolo}\nStato: {stato}\nIntervento: {intervento}\n\nPer qualsiasi cosa risponda a questa mail: la risposta resta collegata alla richiesta {ticket}.\n\n{firma}" },
  aggiornamento: { gruppo: "Mail ai clienti", nome: "Aggiornamento del ticket", chi: "La persona che ha chiesto", quando: "Quando cambia una proprietà del ticket (stato, tecnico, richiesta, urgenza, referente, fornitore)",
    campi: ["nome", "azienda", "ticket", "titolo", "stato", "intervento", "tecnico", "modifiche", "firma"],
    oggetto: "{ticket} - {titolo}: aggiornamento",
    testo: "Buongiorno {nome},\n\nla sua richiesta {ticket} è stata aggiornata:\n{modifiche}\n\nStato: {stato}\nIntervento: {intervento}\n\nPer qualsiasi cosa risponda a questa mail.\n\n{firma}" },
  intervento: { gruppo: "Mail ai clienti", nome: "Intervento fissato o spostato", chi: "La persona che ha chiesto", quando: "Quando si fissa o si sposta la data dell'intervento",
    campi: ["nome", "azienda", "ticket", "titolo", "stato", "intervento", "tecnico", "modifiche", "firma"],
    oggetto: "{ticket} - {titolo}: intervento {intervento}",
    testo: "Buongiorno {nome},\n\nle confermiamo l'intervento per la richiesta {ticket}: {intervento}.\nTecnico: {tecnico}\n\nSe la data non va bene, risponda a questa mail.\n\n{firma}" },
  messaggio: { gruppo: "Mail ai clienti", nome: "Nuovo messaggio sul ticket", chi: "La persona che ha chiesto", quando: "Quando il tecnico o l'ufficio aggiungono un messaggio al ticket (il testo delle note interne non viene mai mostrato)",
    campi: ["nome", "azienda", "ticket", "titolo", "stato", "chi", "firma"],
    oggetto: "{ticket} - {titolo}: nuovo aggiornamento",
    testo: "Buongiorno {nome},\n\n{chi} ha aggiunto un aggiornamento alla sua richiesta {ticket} ({titolo}).\nStato attuale: {stato}\n\nNon serve fare nulla: se ci sono novità per lei la ricontattiamo. Per qualsiasi cosa risponda a questa mail.\n\n{firma}" },
  chiusura: { gruppo: "Mail ai clienti", nome: "Richiesta chiusa", chi: "La persona che ha chiesto", quando: "Quando il ticket passa a «Chiuso»",
    campi: ["nome", "azienda", "ticket", "titolo", "tecnico", "firma"],
    oggetto: "{ticket} - {titolo}: richiesta chiusa",
    testo: "Buongiorno {nome},\n\nla richiesta {ticket} ({titolo}) è stata chiusa.\nSe qualcosa non va, risponda a questa mail e la riapriamo.\n\n{firma}" },
  settimanale: { gruppo: "Mail ai clienti", nome: "Riepilogo settimanale", chi: "Ogni persona con richieste aperte", quando: "Una volta a settimana, nel giorno e nell'ora scelti in Recap ai clienti",
    campi: ["nome", "azienda", "elenco", "firma"],
    oggetto: "Riepilogo settimanale delle sue richieste — {azienda}",
    testo: "Buongiorno {nome},\n\necco le richieste aperte di {azienda}:\n\n{elenco}\n\nPer qualsiasi richiesta risponda a questa mail.\n\n{firma}" },
  testo_cliente: { gruppo: "Testi per i tecnici", nome: "Testo da girare al cliente (ticket nuovo)", chi: "Il tecnico, da copiare su WhatsApp", quando: "Nella conversazione dell'app, quando si apre un ticket nuovo",
    campi: ["nome", "ticket"],
    testo: "Buongiorno {nome}, abbiamo registrato la sua richiesta con il numero {ticket}. La ricontattiamo al più presto. Grazie." },
  firma_tecnico: { gruppo: "Testi per i tecnici", nome: "Firma dei messaggi del tecnico al cliente", chi: "Clienti (in copia)", quando: "In fondo a «Messaggio a …» scritto dall'app",
    campi: ["tecnico", "ticket"],
    testo: "-- {tecnico}, tecnico Efuture. Rispondendo a questa mail la risposta resta nel ticket {ticket}. --" },
  codice_app: { gruppo: "Accesso", nome: "Nuovo codice dell'app", chi: "Il tecnico", quando: "Quando un tecnico tocca «Codice dimenticato?»",
    campi: ["nome", "codice"],
    oggetto: "Ticket Farm: il tuo nuovo codice",
    testo: "Ciao {nome},\n\nil tuo nuovo codice per l'app Ticket Farm è: {codice}\n\nIl codice precedente non funziona più. Se non l'hai chiesto tu, avvisa l'ufficio." },
  reset_password: { gruppo: "Accesso", nome: "Nuova password della console", chi: "L'utente della console", quando: "Quando si tocca «Password dimenticata?»",
    campi: ["nome", "link"],
    oggetto: "Ticket Farm: nuova password",
    testo: "Ciao {nome},\n\nper scegliere una nuova password della console apri questo link entro 30 minuti:\n{link}\n\nSe non l'hai chiesto tu, ignora questa mail: la password resta quella di prima." },
};
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return {}; } };
function all() {
  const saved = load();
  return Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, { ...d, ...(saved[k] || {}), modificato: !!saved[k], predefinito: { oggetto: d.oggetto, testo: d.testo } }]));
}
function get(key) { return all()[key]; }
function update(key, { oggetto, testo }) {
  const d = DEFAULTS[key]; if (!d) return { error: "modello non trovato" };
  if (!String(testo || "").trim()) return { error: "il testo non può essere vuoto" };
  if (d.oggetto !== undefined && !String(oggetto || "").trim()) return { error: "l'oggetto non può essere vuoto" };
  const s = load(); s[key] = { testo: String(testo).slice(0, 5000) }; if (d.oggetto !== undefined) s[key].oggetto = String(oggetto).slice(0, 200);
  fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
  return { ok: true, modello: get(key) };
}
function reset(key) { const s = load(); delete s[key]; fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(s, null, 2)); return { ok: true, modello: get(key) }; }
/* sostituisce i segnaposto; {firma} prende il modello «firma» */
function fill(text, vars) {
  const v = { firma: get("firma").testo, ...vars };
  return String(text || "").replace(/\{(\w+)\}/g, (m, k) => v[k] !== undefined && v[k] !== null ? String(v[k]) : m);
}
function render(key, vars) { const t = get(key); return { oggetto: t.oggetto !== undefined ? fill(t.oggetto, vars) : "", testo: fill(t.testo, vars) }; }
module.exports = { all, get, update, reset, render, fill, DEFAULTS, FILE };

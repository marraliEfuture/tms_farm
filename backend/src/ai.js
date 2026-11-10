/* Assistente AI di Ticket Farm (Claude, API di Anthropic).
   Scrive il promemoria del giorno del tecnico e l'ordine consigliato delle sue attività, con il motivo.
   - con la chiave API (Configurazione → Assistente AI, oppure ANTHROPIC_API_KEY): risposta vera di Claude
   - senza chiave, in prova: risposta di esempio («simulazione»), segnalata come tale
   - se Claude non risponde: il promemoria scritto dalle regole («regole»)
   A Claude vanno solo: data, zona, numero e titolo dei ticket, cliente e città, stato, urgenza, orario.
   Niente telefoni, mail o testo dei messaggi dei clienti. */
const AnthropicMod = require("@anthropic-ai/sdk");
const Anthropic = AnthropicMod.default || AnthropicMod;
const { z } = require("zod");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");
const settings = require("./settings");

/* prezzi in dollari per milione di token (listino Anthropic) e stima dei token di una richiesta */
const MODELS = {
  "claude-opus-5-5": { nome: "Claude Opus 5.5", nota: "il più capace (consigliato)", in: 4, out: 20 },
  "claude-sonnet-5-5": { nome: "Claude Sonnet 5.5", nota: "veloce, buon equilibrio", in: 2, out: 10 },
  "claude-haiku-5-5": { nome: "Claude Haiku 5.5", nota: "il più economico", in: 0.1, out: 0.5 },
};
const TOKENS_IN = 1800, TOKENS_OUT = 700;          /* stima per tecnico al giorno, ragionamento compreso */
function monthlyCost(model, techs, days) {
  const m = MODELS[model] || MODELS["claude-opus-5-5"];
  return (TOKENS_IN * m.in + TOKENS_OUT * m.out) / 1e6 * (techs || 1) * (days || 22);
}

const Agenda = z.object({
  promemoria: z.string().describe("3-5 frasi in italiano per il tecnico"),
  attivita: z.array(z.object({ ticket: z.string().describe("numero del ticket, uguale ai dati"), perche: z.string().describe("motivo in una frase breve") })),
});
const SYSTEM = [
  "Sei l'assistente di Ticket Farm per un tecnico dell'assistenza sul campo.",
  "Scrivi il promemoria della sua giornata: da 3 a 5 frasi semplici in italiano, tono diretto e cordiale, senza elenchi, titoli o emoji.",
  "Prima le urgenze da pianificare, poi gli interventi di oggi in ordine di orario, poi quelli dei prossimi giorni, infine i ticket in attesa (per esempio di un ricambio) con cosa fare.",
  "Se dal titolo si capisce cosa portare con sé (ricambi, kit, strumenti di taratura) dillo in poche parole.",
  "Usa solo i dati ricevuti: non inventare orari, clienti, persone o fatti.",
  "Poi elenca tutti i ticket nell'ordine in cui conviene affrontarli, ognuno con il motivo in una frase breve.",
].join("\n");

let makeClient = key => new Anthropic(key ? { apiKey: key } : {});
function setClientFactory(fn) { makeClient = fn; }          /* per i test */

function configured() { const a = settings.ai(); return !!(a.enabled && (a.apiKey || process.env.ANTHROPIC_API_KEY)); }

/* dati per Claude: solo quello che serve, una riga per ticket */
function contextText({ tech, tickets, clients, date }) {
  const name = id => (clients.find(c => c.id === id) || { name: id }).name;
  const city = id => (clients.find(c => c.id === id) || {}).city || "";
  const lines = tickets.map(t => "- " + [t.id, name(t.client) + (city(t.client) ? " (" + city(t.client) + ")" : ""), t.title, "stato: " + t.state,
    t.urg ? "URGENTE" : "", t.plan ? (t.plan.day === 0 ? "oggi" : t.plan.day === 1 ? "domani" : "tra " + t.plan.day + " giorni") + " alle " + t.plan.time : "non pianificato"].filter(Boolean).join(" · "));
  return "Data: " + date + "\nTecnico: " + (tech.nome || tech.ini) + ", zona " + (tech.zona || "") + "\nTicket aperti assegnati a lui:\n" + (lines.join("\n") || "(nessuno)");
}

const cache = new Map();
async function agenda(input, opts) {
  const a = settings.ai(), key = a.apiKey || process.env.ANTHROPIC_API_KEY, model = a.model;
  const ctx = contextText(input);
  const ck = model + "|" + ctx;
  if (!(opts && opts.fresh) && cache.has(ck)) return { ...cache.get(ck), cached: true };
  const client = makeClient(key);
  const resp = await client.beta.messages.parse({
    model,
    max_tokens: 4000,
    /* se il modello rifiuta, l'API riprova da sola con un altro modello adatto */
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: zodOutputFormat(Agenda) },
    system: SYSTEM,
    messages: [{ role: "user", content: ctx }],
  });
  if (resp.stop_reason === "refusal") throw new Error("Claude ha rifiutato la richiesta" + (resp.stop_details && resp.stop_details.category ? " (" + resp.stop_details.category + ")" : ""));
  if (resp.stop_reason === "max_tokens") throw new Error("risposta troppo lunga, interrotta");
  const out = resp.parsed_output;
  if (!out) throw new Error("risposta di Claude non leggibile");
  const ids = new Set(input.tickets.map(t => t.id));
  const r = { source: "claude", model: resp.model, text: out.promemoria.trim(), order: out.attivita.filter(x => ids.has(x.ticket)),
    usage: { in: resp.usage.input_tokens, out: resp.usage.output_tokens } };
  cache.set(ck, r);
  return r;
}

/* risposta di esempio, quando l'assistente è acceso senza chiave (solo in prova) */
function simulate({ tech, tickets, clients }) {
  const name = id => (clients.find(c => c.id === id) || { name: id }).name;
  const urg = tickets.filter(t => t.urg && !t.plan), today = tickets.filter(t => t.plan && t.plan.day === 0).sort((x, y) => x.plan.time.localeCompare(y.plan.time));
  const later = tickets.filter(t => t.plan && t.plan.day > 0).sort((x, y) => x.plan.day - y.plan.day), wait = tickets.filter(t => !t.plan && !t.urg && /attesa/i.test(t.state));
  const rest = tickets.filter(t => !urg.includes(t) && !today.includes(t) && !later.includes(t) && !wait.includes(t));
  const f = [];
  if (urg[0]) f.push("La priorità di oggi è " + name(urg[0].client) + ": l'" + urg[0].title.split(":")[0].toLowerCase() + " dà " + (urg[0].title.split(":")[1] || "problemi").trim() + " ed è urgente ma non ancora pianificato, quindi chiama il cliente in mattinata e fissa l'intervento.");
  if (today[0]) f.push("Alle " + today[0].plan.time + " sei da " + name(today[0].client) + " per la " + today[0].title.split(":").slice(-1)[0].trim() + ": porta il kit di taratura.");
  if (later[0]) f.push((later[0].plan.day === 1 ? "Domani" : "Tra " + later[0].plan.day + " giorni") + " alle " + later[0].plan.time + " ti aspetta " + name(later[0].client) + (/lampada/i.test(later[0].title) ? ": verifica di avere una lampada di ricambio." : "."));
  if (wait[0]) f.push("Per " + name(wait[0].client) + " (" + wait[0].id + ") controlla se il ricambio è arrivato e, se sì, proponi una data.");
  const why = t => urg.includes(t) ? "Urgente e senza data: va pianificato per primo." : today.includes(t) ? "È in agenda oggi alle " + t.plan.time + "." : later.includes(t) ? "Già pianificato: basta prepararsi." : wait.includes(t) ? "Dipende dal ricambio: solo un controllo veloce." : "Da pianificare quando hai tempo.";
  return { source: "simulazione", model: settings.ai().model, text: f.join(" ") || "Oggi non hai attività aperte.", order: [...urg, ...today, ...wait, ...later, ...rest].map(t => ({ ticket: t.id, perche: why(t) })) };
}
/* ---- suggerimenti per chi coordina (responsabile, amministratore) ---- */
const Team = z.object({
  riepilogo: z.string().describe("2-3 frasi in italiano sulla situazione di oggi"),
  suggerimenti: z.array(z.object({ titolo: z.string().describe("azione concreta, max 10 parole"), perche: z.string().describe("motivo in una frase"),
    ticket: z.string().describe("numero del ticket interessato, oppure stringa vuota") })),
});
const SYSTEM_TEAM = [
  "Sei l'assistente di Ticket Farm per il responsabile del service, che coordina i tecnici sul campo.",
  "Scrivi un riepilogo di 2-3 frasi in italiano sulla situazione di oggi, poi da 3 a 5 suggerimenti concreti, in ordine di importanza.",
  "Guarda: urgenze senza data o senza tecnico, ticket senza tecnico (proponi il tecnico più libero, della zona giusta se si capisce), carico di lavoro sbilanciato, ticket fermi in attesa (ricambi), mail da verificare.",
  "Ogni suggerimento è un'azione che il responsabile può fare subito, con il motivo. Usa solo i dati ricevuti, non inventare nulla.",
].join("\n");
function teamText({ tickets, clients, techs, toCheck, date }) {
  const name = id => (clients.find(c => c.id === id) || { name: id }).name;
  const load = techs.map(t => t.ini + " (" + (t.nome || "") + ", zona " + (t.zona || "?") + "): " + tickets.filter(x => x.tech === t.ini).length + " ticket aperti").join("\n");
  const lines = tickets.map(t => "- " + [t.id, name(t.client), t.title, "stato: " + t.state, t.urg ? "URGENTE" : "", "tecnico: " + (t.tech || "nessuno"),
    t.plan ? (t.plan.day === 0 ? "oggi" : t.plan.day === 1 ? "domani" : "tra " + t.plan.day + " giorni") + " alle " + t.plan.time : "non pianificato"].filter(Boolean).join(" · "));
  return "Data: " + date + "\nTecnici e carico:\n" + load + "\nMail da verificare in posta: " + (toCheck || 0) + "\nTicket aperti:\n" + (lines.join("\n") || "(nessuno)");
}
async function team(input, opts) {
  const a = settings.ai(), key = a.apiKey || process.env.ANTHROPIC_API_KEY, ctx = teamText(input), ck = "team|" + a.model + "|" + ctx;
  if (!(opts && opts.fresh) && cache.has(ck)) return { ...cache.get(ck), cached: true };
  const resp = await makeClient(key).beta.messages.parse({
    model: a.model, max_tokens: 4000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: zodOutputFormat(Team) }, system: SYSTEM_TEAM, messages: [{ role: "user", content: ctx }],
  });
  if (resp.stop_reason === "refusal") throw new Error("Claude ha rifiutato la richiesta");
  if (!resp.parsed_output) throw new Error("risposta di Claude non leggibile");
  const ids = new Set(input.tickets.map(t => t.id));
  const r = { source: "claude", model: resp.model, text: resp.parsed_output.riepilogo.trim(),
    tips: resp.parsed_output.suggerimenti.map(x => ({ titolo: x.titolo, perche: x.perche, ticket: ids.has(x.ticket) ? x.ticket : "" })) };
  cache.set(ck, r); return r;
}
function simulateTeam({ tickets, clients, techs, toCheck }) {
  const name = id => (clients.find(c => c.id === id) || { name: id }).name;
  const load = t => tickets.filter(x => x.tech === t.ini).length;
  const freest = techs.slice().sort((x, y) => load(x) - load(y))[0], busiest = techs.slice().sort((x, y) => load(y) - load(x))[0];
  const tips = [];
  for (const t of tickets.filter(x => x.urg && !x.plan)) tips.push({ titolo: "Pianifica l'urgenza di " + name(t.client), perche: t.title + ": è urgente ma senza data" + (t.tech ? ", assegnato a " + t.tech + "." : " e senza tecnico."), ticket: t.id });
  for (const t of tickets.filter(x => !x.tech)) tips.push({ titolo: "Assegna " + t.id + " a " + (freest ? freest.ini : "un tecnico"), perche: "Nessun tecnico per «" + t.title + "» di " + name(t.client) + (freest ? "; " + freest.ini + " ha " + load(freest) + " ticket aperti." : "."), ticket: t.id });
  if (toCheck) tips.push({ titolo: "Verifica " + toCheck + " mail in Posta in arrivo", perche: "Non hanno ticket né cliente riconosciuto: finché restano lì nessuno le segue.", ticket: "" });
  if (busiest && freest && load(busiest) - load(freest) >= 3) tips.push({ titolo: "Alleggerisci " + busiest.ini, perche: busiest.ini + " ha " + load(busiest) + " ticket aperti, " + freest.ini + " solo " + load(freest) + ": sposta un intervento non urgente.", ticket: "" });
  for (const t of tickets.filter(x => /attesa/i.test(x.state))) tips.push({ titolo: (/cliente/i.test(t.state) ? "Risenti il cliente " : "Sollecita il ricambio per ") + name(t.client), perche: t.id + " è fermo in «" + t.state.toLowerCase() + "».", ticket: t.id });
  const urg = tickets.filter(x => x.urg).length, unas = tickets.filter(x => !x.tech).length;
  const text = "Oggi ci sono " + tickets.length + " ticket aperti" + (urg ? ", " + urg + " urgent" + (urg === 1 ? "e" : "i") : "") + (unas ? " e " + unas + " senza tecnico" : "") + ". " +
    (busiest ? "Il più carico è " + busiest.ini + " con " + load(busiest) + " ticket" + (freest && freest !== busiest ? ", il più libero " + freest.ini + " con " + load(freest) + "." : ".") : "");
  return { source: "simulazione", model: settings.ai().model, text, tips: tips.slice(0, 5) };
}
module.exports = { team, simulateTeam, teamText, MODELS, monthlyCost, configured, agenda, simulate, contextText, setClientFactory, SYSTEM };

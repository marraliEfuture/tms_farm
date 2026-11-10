/* Office 365 (Microsoft Graph): legge la posta in arrivo e i contatti della casella di raccolta.
   Serve un'app registrata in Entra ID con permessi applicativi Mail.Read e Contacts.Read (consenso dell'amministratore),
   limitata con una Application Access Policy alla sola casella di raccolta. Impostazioni: console → Configurazione → Office 365. */
const settings = require("../settings");
let tok = null, tokExp = 0, tokKey = "";
const configured = () => { const g = settings.graph(); return !!(g.tenant && g.clientId && g.clientSecret && g.mailbox); };

async function token() {
  const g = settings.graph(), key = g.tenant + "|" + g.clientId + "|" + g.clientSecret;
  if (tok && key === tokKey && Date.now() < tokExp) return tok;
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(g.tenant)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: g.clientId, client_secret: g.clientSecret, scope: "https://graph.microsoft.com/.default" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("accesso a Microsoft non riuscito: " + (j.error_description || j.error || r.status).toString().split("\r\n")[0]);
  tok = j.access_token; tokKey = key; tokExp = Date.now() + (j.expires_in - 60) * 1000; return tok;
}
async function get(pathAndQuery) {
  const r = await fetch("https://graph.microsoft.com/v1.0" + pathAndQuery, { headers: { Authorization: "Bearer " + await token() } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && (j.error.code + ": " + j.error.message)) || ("Graph " + r.status));
  return j;
}
const box = () => "/users/" + encodeURIComponent(settings.graph().mailbox);
const KEEP = /^(in-reply-to|references|x-ticketfarm-)/i;

/* ultime mail della posta in arrivo, con le intestazioni che servono al riconoscimento */
async function inbox(top) {
  const sel = "$select=subject,from,receivedDateTime,bodyPreview,internetMessageId,internetMessageHeaders";
  const j = await get(box() + "/mailFolders/inbox/messages?$top=" + (top || 25) + "&$orderby=receivedDateTime desc&" + sel);
  return (j.value || []).map(m => ({
    id: "g-" + m.id.slice(-24), at: new Date(m.receivedDateTime).toLocaleString("it-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    from: ((m.from || {}).emailAddress || {}).address || "", fromName: ((m.from || {}).emailAddress || {}).name || "",
    subj: m.subject || "(senza oggetto)", body: m.bodyPreview || "",
    hdr: (m.internetMessageHeaders || []).filter(h => KEEP.test(h.name)).map(h => [h.name, h.value]),
  }));
}
async function contacts() {
  if (!configured() || !settings.graph().readContacts) return [];
  const j = await get(box() + "/contacts?$top=999&$select=displayName,emailAddresses,mobilePhone,businessPhones,companyName");
  return (j.value || []).map(c => {
    const mail = ((c.emailAddresses || [])[0] || {}).address || "";
    return { n: c.displayName, src: "O365", mail, tel: c.mobilePhone || (c.businessPhones || [])[0] || "", company: c.companyName || "", dom: (mail.split("@")[1] || "").toLowerCase() };
  });
}
/* prova passo per passo, per la schermata della console */
async function test() {
  const g = settings.graph(), steps = [];
  const step = async (t, fn) => { try { const d = await fn(); steps.push({ ok: true, t, d }); return true; } catch (e) { steps.push({ ok: false, t, d: e.message }); return false; } };
  if (!configured()) return { ok: false, steps: [{ ok: false, t: "Dati mancanti", d: "Servono tenant, client id, segreto e casella da leggere." }] };
  if (!await step("Accesso a Microsoft (tenant " + g.tenant + ")", async () => { await token(); return "token ottenuto"; })) return { ok: false, steps };
  let messages = [];
  if (g.readMail) await step("Posta in arrivo di " + g.mailbox, async () => {
    const f = await get(box() + "/mailFolders/inbox?$select=totalItemCount,unreadItemCount");
    messages = await inbox(5);
    return f.totalItemCount + " mail, " + f.unreadItemCount + " da leggere";
  });
  if (g.readContacts) await step("Contatti di " + g.mailbox, async () => (await contacts()).length + " contatti");
  return { ok: steps.every(s => s.ok), steps, messages };
}
module.exports = { name: "Office 365", configured, contacts, inbox, test };

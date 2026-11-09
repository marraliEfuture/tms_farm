/* Office 365 (Microsoft Graph): legge i contatti della casella indicata in GRAPH_CONTACTS_MAILBOX.
   Serve un'app registrata in Entra ID con il permesso applicativo Contacts.Read. */
const cfg = require("../config");
let tok = null, tokExp = 0;
const configured = () => !!(cfg.graph.tenant && cfg.graph.clientId && cfg.graph.clientSecret && cfg.graph.mailbox);

async function token() {
  if (tok && Date.now() < tokExp) return tok;
  const r = await fetch(`https://login.microsoftonline.com/${cfg.graph.tenant}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.graph.clientId, client_secret: cfg.graph.clientSecret, scope: "https://graph.microsoft.com/.default" }),
  });
  if (!r.ok) throw new Error("Office 365: accesso non riuscito (" + r.status + ")");
  const j = await r.json(); tok = j.access_token; tokExp = Date.now() + (j.expires_in - 60) * 1000; return tok;
}
module.exports = {
  name: "Office 365", configured,
  /* contatti con il loro dominio: vengono aggiunti al cliente con lo stesso dominio */
  async contacts() {
    if (!configured()) return [];
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.graph.mailbox)}/contacts?$top=999&$select=displayName,emailAddresses,mobilePhone,businessPhones,companyName`;
    const r = await fetch(url, { headers: { Authorization: "Bearer " + await token() } });
    if (!r.ok) throw new Error("Office 365 contatti: " + r.status);
    const j = await r.json();
    return (j.value || []).map(c => {
      const mail = ((c.emailAddresses || [])[0] || {}).address || "";
      return { n: c.displayName, src: "O365", mail, tel: c.mobilePhone || (c.businessPhones || [])[0] || "", company: c.companyName || "", dom: (mail.split("@")[1] || "").toLowerCase() };
    });
  },
};

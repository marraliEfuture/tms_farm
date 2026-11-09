/* Halo (API REST). Documentazione: https://halopsa.com/apidoc/
   Controllare i nomi dei campi con la propria installazione di Halo prima di andare in produzione. */
const cfg = require("../config");
let tok = null, tokExp = 0;

async function token() {
  if (tok && Date.now() < tokExp) return tok;
  const r = await fetch(cfg.halo.url + "/auth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.halo.clientId, client_secret: cfg.halo.clientSecret, scope: "all" }),
  });
  if (!r.ok) throw new Error("Halo: accesso non riuscito (" + r.status + ")");
  const j = await r.json(); tok = j.access_token; tokExp = Date.now() + (j.expires_in - 60) * 1000; return tok;
}
async function get(path) {
  const r = await fetch(cfg.halo.url + "/api" + path, { headers: { Authorization: "Bearer " + await token() } });
  if (!r.ok) throw new Error("Halo " + path + ": " + r.status);
  return r.json();
}
const configured = () => !!(cfg.halo.url && cfg.halo.clientId && cfg.halo.clientSecret);

module.exports = {
  name: "Halo", configured,
  async clients() {
    if (!configured()) return [];
    const [c, u] = await Promise.all([get("/Client?pageinate=false"), get("/Users?pageinate=false")]);
    const users = u.users || [];
    return (c.clients || []).map(x => {
      const contacts = users.filter(y => y.client_id === x.id).map(y => ({ n: y.name, src: "Halo", mail: y.emailaddress || "", tel: y.phonenumber || y.mobilenumber || "" }));
      const dom = (contacts.find(k => k.mail) || { mail: "" }).mail.split("@")[1] || "";
      return { id: "halo-" + x.id, name: x.name, city: "", sys: "Halo", dom: dom.toLowerCase(), contacts };
    });
  },
  async tickets() {
    if (!configured()) return [];
    const t = await get("/Tickets?open_only=true&pageinate=false");
    return (t.tickets || []).map(x => ({
      id: "HALO-" + x.id, sys: "Halo", client: "halo-" + x.client_id, title: x.summary || "", state: x.status_name || "Aperto",
      tech: x.agent_name || "", urg: x.priority_id === 1, origin: "Halo", upd: (x.lastactiondate || "").slice(0, 16).replace("T", " "),
      /* Identificativo dell'ultima mail mandata da Halo: da completare (dipende da come Halo registra le mail in uscita). */
      msgIds: [],
    }));
  },
};

/* ITSM di Efuture (itsm.efuture.it).
   DA COMPLETARE: questo collegamento si aspetta tre letture. Adattare gli indirizzi alle API
   o al database reali di ITSM.
     GET  {ITSM_API_URL}/clients        -> [{ id, name, city, contacts: [{ name, mail, phone }] }]
     GET  {ITSM_API_URL}/tickets?open=1 -> [{ number, client_id, title, state, technician, urgent, updated }]
     GET  {ITSM_API_URL}/tickets/{number}/last-message-id -> { messageId: "<...@itsm.efuture.it>" }
   L'ultima lettura serve per In-Reply-To: è l'identificativo dell'ultima mail mandata da ITSM per quel ticket,
   come nella mail "Re: Tck #714130" che ITSM già riconosce. */
const cfg = require("../config");
const configured = () => !!cfg.itsm.url;

async function get(path) {
  const r = await fetch(cfg.itsm.url + path, { headers: cfg.itsm.token ? { Authorization: "Bearer " + cfg.itsm.token } : {} });
  if (!r.ok) throw new Error("ITSM " + path + ": " + r.status);
  return r.json();
}
module.exports = {
  name: "ITSM", configured,
  async clients() {
    if (!configured()) return [];
    return (await get("/clients")).map(c => {
      const contacts = (c.contacts || []).map(k => ({ n: k.name, src: "ITSM", mail: k.mail || "", tel: k.phone || "" }));
      const dom = (contacts.find(k => k.mail) || { mail: "" }).mail.split("@")[1] || "";
      return { id: "itsm-" + c.id, name: c.name, city: c.city || "", sys: "ITSM", dom: dom.toLowerCase(), contacts };
    });
  },
  async tickets() {
    if (!configured()) return [];
    const list = await get("/tickets?open=1");
    return Promise.all(list.map(async t => {
      let msgIds = [];
      try { const m = await get("/tickets/" + encodeURIComponent(t.number) + "/last-message-id"); if (m.messageId) msgIds = [m.messageId]; } catch (e) { /* senza identificativo resta l'oggetto */ }
      return { id: "Tck #" + t.number, sys: "ITSM", client: "itsm-" + t.client_id, title: t.title || "", state: t.state || "Aperto",
        tech: t.technician || "", urg: !!t.urgent, origin: "ITSM", upd: t.updated || "", msgIds };
    }));
  },
};

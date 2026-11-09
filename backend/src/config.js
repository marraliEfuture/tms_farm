/* Legge la configurazione da .env (senza librerie esterne) e dalle variabili d'ambiente. */
const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const e = process.env;
module.exports = {
  port: Number(e.PORT || 8080),
  secret: e.SECRET || "solo-per-prova",
  support: e.SUPPORT_ADDRESS || "support@efuture.it",
  appUrl: e.APP_URL || "",
  adminUser: e.ADMIN_USER || "admin",
  adminPassword: e.ADMIN_PASSWORD || "",
  mode: (e.MODE || "demo").toLowerCase() === "live" ? "live" : "demo",
  smtp: { host: e.SMTP_HOST || "", port: Number(e.SMTP_PORT || 587), secure: String(e.SMTP_SECURE) === "true", user: e.SMTP_USER || "", pass: e.SMTP_PASS || "" },
  halo: { url: (e.HALO_URL || "").replace(/\/$/, ""), clientId: e.HALO_CLIENT_ID || "", clientSecret: e.HALO_CLIENT_SECRET || "" },
  itsm: { url: (e.ITSM_API_URL || "").replace(/\/$/, ""), token: e.ITSM_TOKEN || "" },
  graph: { tenant: e.GRAPH_TENANT_ID || "", clientId: e.GRAPH_CLIENT_ID || "", clientSecret: e.GRAPH_CLIENT_SECRET || "", mailbox: e.GRAPH_CONTACTS_MAILBOX || "" },
  dataDir: path.join(__dirname, "..", "data"),
  outboxDir: path.join(__dirname, "..", "outbox"),
};

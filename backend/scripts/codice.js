/* Aggiunge o aggiorna un tecnico e gli genera un codice di accesso.
   Uso: npm run codice -- mail@efuture.it "Nome Cognome" INI Zona
   Il codice viene mostrato una sola volta: nel file resta solo la sua impronta. */
const fs = require("fs");
const crypto = require("crypto");
const auth = require("../src/auth");
const cfg = require("../src/config");

const [mail, nome, ini, zona] = process.argv.slice(2);
if (!mail || !mail.includes("@")) { console.log('Uso: npm run codice -- mail@efuture.it "Nome Cognome" INI Zona'); process.exit(1); }
const list = fs.existsSync(auth.TECH_FILE) ? JSON.parse(fs.readFileSync(auth.TECH_FILE, "utf8")) : [];
const code = String(crypto.randomInt(100000, 1000000));
const rec = { mail, nome: nome || mail, ini: (ini || mail.slice(0, 2)).toUpperCase(), zona: zona || "", hash: auth.hashCode(mail, code) };
const i = list.findIndex(t => t.mail.toLowerCase() === mail.toLowerCase());
if (i >= 0) list[i] = rec; else list.push(rec);
fs.mkdirSync(cfg.dataDir, { recursive: true });
fs.writeFileSync(auth.TECH_FILE, JSON.stringify(list, null, 2));
console.log(`Tecnico ${rec.mail} salvato. Codice di accesso: ${code}`);

/* Registra i 10 video dei tutorial della console (backend/admin/tutorial/N-id.mp4 + .jpg).
   Serve: Playwright con Chromium e ffmpeg.
   Uso (dalla cartella principale del repository):
     node tools/tutorial/registra.js            -> tutti
     node tools/tutorial/registra.js 3 4        -> solo alcuni (numero del tutorial)
   Lo script avvia da solo il backend in prova (porta 8201) e una copia statica della console (porta 8202). */
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs"), path = require("path"), http = require("http");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "backend/admin/tutorial");
const SHOTS = path.join(OUT, "shots");
let CUR = "";   /* tutorial in registrazione, per i nomi delle foto */
const TMP = fs.mkdtempSync(path.join(require("os").tmpdir(), "tf-video-"));
const BE = "http://localhost:8201", ST = "http://localhost:8202";
const W = 1280, Hh = 720;
const wait = ms => new Promise(r => setTimeout(r, ms));

/* sovrimpressioni: titolo, didascalie e cursore visibile */
const OVERLAY = `(() => {
  const css = '#tfv-cap{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);max-width:82%;background:rgba(5,9,15,.86);color:#fff;font:600 22px/1.35 Poppins,system-ui,sans-serif;padding:14px 22px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.4);z-index:2147483646;text-align:center;opacity:0;transition:opacity .3s;border:1px solid rgba(42,167,255,.35);pointer-events:none}'
    + '#tfv-cap.on{opacity:1}'
    + '#tfv-title{position:fixed;inset:0;z-index:2147483647;background:radial-gradient(60% 60% at 50% 40%,#0b2a4a,#000 75%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;color:#fff;font-family:Poppins,system-ui,sans-serif;text-align:center;padding:40px;transition:opacity .4s}'
    + '#tfv-title .k{font-size:20px;letter-spacing:.2em;text-transform:uppercase;color:#19c2c9;font-weight:600}'
    + '#tfv-title .t{font-size:46px;font-weight:700;max-width:1000px;line-height:1.15}'
    + '#tfv-title .w{font-size:20px;color:#d9ab45;font-weight:600}'
    + '#tfv-cur{position:fixed;left:640px;top:360px;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(42,167,255,.35);border:3px solid #2aa7ff;z-index:2147483645;pointer-events:none;transition:left .6s ease,top .6s ease,transform .15s}'
    + '#tfv-cur.tap{transform:scale(.7);background:rgba(42,167,255,.7)}';
  function ensure(){
    if (document.getElementById('tfv-cap') || !document.body) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const c = document.createElement('div'); c.id = 'tfv-cap'; document.body.appendChild(c);
    const k = document.createElement('div'); k.id = 'tfv-cur'; document.body.appendChild(k);
  }
  window.__tf = {
    cap(t){ ensure(); const c = document.getElementById('tfv-cap'); if(!t){ c.classList.remove('on'); return; } c.textContent = t; c.classList.add('on'); },
    title(k, t, w){ ensure(); let e = document.getElementById('tfv-title'); if(!e){ e = document.createElement('div'); e.id = 'tfv-title'; document.body.appendChild(e); }
      e.style.opacity = 1; e.innerHTML = '<span class="k">'+k+'</span><span class="t">'+t+'</span>'+(w?'<span class="w">'+w+'</span>':''); },
    untitle(){ const e = document.getElementById('tfv-title'); if(e){ e.style.opacity = 0; setTimeout(()=>e.remove(), 400); } },
    move(x, y){ ensure(); const k = document.getElementById('tfv-cur'); k.style.left = x+'px'; k.style.top = y+'px'; },
    tap(){ const k = document.getElementById('tfv-cur'); k.classList.add('tap'); setTimeout(()=>k.classList.remove('tap'), 180); }
  };
  document.addEventListener('DOMContentLoaded', ensure);
})();`;

async function newPage(browser, name, extra) {
  const ctx = await browser.newContext({ viewport: { width: W, height: Hh }, colorScheme: "dark", recordVideo: { dir: path.join(TMP, name), size: { width: W, height: Hh } }, permissions: ["clipboard-read", "clipboard-write"], ...(extra || {}) });
  await ctx.addInitScript(OVERLAY);
  const p = await ctx.newPage();
  return { ctx, p };
}
const H = p => ({
  cap: async (t, ms = 2600) => { await p.evaluate(t => window.__tf.cap(t), t); await wait(ms); },
  hide: async () => p.evaluate(() => window.__tf.cap("")),
  title: async (k, t, w, ms = 3200) => { await p.evaluate(([k, t, w]) => window.__tf.title(k, t, w), [k, t, w]); await wait(ms); await p.evaluate(() => window.__tf.untitle()); await wait(500); },
  point: async sel => { const l = p.locator(sel).first(); await l.scrollIntoViewIfNeeded(); const b = await l.boundingBox(); await p.evaluate(([x, y]) => window.__tf.move(x, y), [b.x + b.width / 2, b.y + b.height / 2]); await wait(750); },
  click: async (sel, after = 700) => { const h = H(p); await h.point(sel); await p.evaluate(() => window.__tf.tap()); await p.locator(sel).first().click(); await wait(after); },
  type: async (sel, text) => { const h = H(p); await h.click(sel, 200); await p.locator(sel).first().pressSequentially(text, { delay: 35 }); await wait(400); },
  snap: async (k) => {
    await p.evaluate(() => window.__tf.cap("")); await wait(350);
    const isApp = p.url().includes("/app/"), file = path.join(SHOTS, CUR + "-" + k + ".png");
    await p.screenshot({ path: file, clip: isApp ? { x: (W - 560) / 2, y: 0, width: 560, height: Hh } : { x: 0, y: 0, width: W, height: Hh } });
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", "scale=" + (isApp ? 420 : 960) + ":-1", "-q:v", "5", file.replace(/\.png$/, ".jpg")]);
    fs.unlinkSync(file);
  },
  paste: async (sel, text) => { const h = H(p); await h.click(sel, 300); await p.locator(sel).first().fill(text); await wait(900); },
});
async function finish(ctx, p, file, intro) {
  await p.evaluate(() => window.__tf.title("Ticket Farm", "Fatto", "Trovi la procedura completa sotto il video"));
  await wait(2200);
  const v = p.video(); await ctx.close();
  const webm = await v.path();
  const mp4 = path.join(OUT, file + ".mp4"), jpg = path.join(OUT, file + ".jpg");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", webm, "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(intro), "-i", mp4, "-frames:v", "1", "-q:v", "4", jpg]);
  console.log("  ->", path.relative(ROOT, mp4), Math.round(fs.statSync(mp4).size / 1024) + " KB");
}
async function appLogin(p, h, showIntro) {
  await p.goto(BE + "/app/");
  if (showIntro) await wait(4200);
  await p.locator("#splash-skip").click().catch(() => {});
  await p.waitForSelector("#l-fill"); await wait(500);
  await h.cap("Il tecnico entra con la sua mail e il codice", 1600);
  await h.click("#l-fill", 1200);
}
async function adminLogin(p, h, base) {
  await p.goto(base + "/admin/"); await p.waitForSelector("#lg-fill"); await wait(500);
  await h.click("#lg-fill", 1200);
}

/* ogni video: id del tutorial (stesso ordine e numero della console) */
const ORDER = ["profilo", "tecnico", "installa", "cliente", "riconoscimento", "whatsapp", "mail", "rispondi", "verifica", "telefono"];
const VIDEOS = {
  async profilo(browser, n, file) {
    const { ctx, p } = await newPage(browser, file); const h = H(p);
    await p.goto(BE + "/admin/"); await h.title("Tutorial " + n + " · Console", "Primo accesso alla console e profilo");
    await p.waitForSelector("#lg-fill"); await h.cap("All'apertura compare la schermata di accesso", 2200); await h.snap(1);
    await h.type("#lg-user", "admin"); await h.type("#lg-pass", "admin123"); await h.hide(); await h.click("#lg-go", 1400);
    await h.cap("In alto a destra: l'icona con le tue iniziali", 1800); await h.click("#me", 1000); await h.snap(2);
    await h.click("#me-edit", 900); await h.cap("Completa nome e mail", 1200);
    await p.fill("#pf-nome", ""); await h.type("#pf-nome", "Ufficio Service"); await p.fill("#pf-mail", ""); await h.type("#pf-mail", "service@efuture.it"); await h.snap(3);
    await h.cap("Sostituisci la password di prova: serve la password attuale per salvare", 2400);
    await h.type("#pf-new", "Servizio2026"); await h.type("#pf-new2", "Servizio2026"); await h.type("#pf-cur", "admin123"); await h.snap(4);
    await h.hide(); await h.click('#pf-form button[type="submit"]', 1500);
    await h.click("#theme", 1200); await h.cap("L'interruttore sole/luna cambia il tema, anche nell'app", 2600); await h.snap(5);
    await h.click("#theme", 900); await h.click("#me", 900); await h.cap("Per uscire: menu utente → Esci", 1800); await h.snap(6); await h.click("#me-out", 1500);
    await finish(ctx, p, file, 1.5);
  },
  async tecnico(browser, n, file) {
    const { ctx, p } = await newPage(browser, file); const h = H(p);
    await p.goto(BE + "/admin/"); await h.title("Tutorial " + n + " · Console", "Aggiungere un tecnico e dargli l'accesso");
    await adminLogin(p, h, BE);
    await h.click('[data-v="tecnici"]', 900); await h.click("#t-add", 900); await h.snap(1);
    await h.type("#tf-nome", "Mario Rossi"); await h.type("#tf-ini", "MR"); await h.type("#tf-zona", "Nord"); await h.type("#tf-mail", "m.rossi@efuture.it"); await h.snap(2);
    await h.cap("La mail aziendale è la casella da cui partiranno i suoi messaggi", 2400); await h.hide();
    await h.click('#ed-form button[type="submit"]', 1200);
    const code = (await p.textContent(".code")).trim();
    await h.point(".code"); await h.cap("Ecco il codice di accesso: si vede una sola volta, consegnalo al tecnico", 3600); await h.snap(3);
    await h.click("#ed-form [data-close]", 1000); await h.cap("Mario Rossi è nell'elenco dei tecnici", 2000); await h.hide();
    await p.goto(BE + "/app/"); await p.locator("#splash-skip").click().catch(() => {}); await p.waitForSelector("#l-mail"); await wait(600);
    await h.cap("Sul suo telefono il tecnico apre l'app e scrive mail e codice", 2000);
    await h.type("#l-mail", "m.rossi@efuture.it"); await h.type("#l-code", code); await h.snap(4); await h.hide(); await h.click("#l-go", 1800);
    await h.cap("È dentro: l'app è pronta per inoltrare i messaggi dei suoi clienti", 3000);
    await finish(ctx, p, file, 1.5);
  },
  async installa(browser, n, file) {
    const { ctx, p } = await newPage(browser, file, { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" }); const h = H(p);
    await p.goto(BE + "/app/"); await h.title("Tutorial " + n + " · App del tecnico", "Installare l'app sul telefono del tecnico");
    await p.goto(BE + "/app/"); await h.cap("Al primo avvio parte l'introduzione con il logo", 4000); await h.snap(1); await h.snap(3); await h.hide();
    await h.click("#splash-skip", 900); await h.cap("Il tecnico accede con mail e codice", 1600); await h.snap(4); await h.click("#l-fill", 1500);
    await h.point("#install"); await h.cap("L'app spiega come installarla: su iPhone Condividi → Aggiungi alla schermata Home", 3600); await h.snap(2);
    await h.cap("Su Android compare il pulsante Installa, oppure menu ⋮ → Installa app", 3200);
    await h.click("#theme", 1200); await h.cap("Interruttore sole/luna per il tema chiaro o scuro", 2400); await h.snap(5); await h.click("#theme", 800);
    await h.click("#brand", 600); await h.cap("Toccando Ticket Farm in alto si rivede l'introduzione e si torna alla home", 3200); await h.hide();
    await p.locator("#splash-skip").click().catch(() => {}); await wait(1200);
    await finish(ctx, p, file, 1.5);
  },
  async cliente(browser, n, file) {
    const { ctx, p } = await newPage(browser, file); const h = H(p);
    await p.goto(ST + "/admin/"); await h.title("Tutorial " + n + " · Console", "Aggiungere un cliente con i suoi contatti");
    await adminLogin(p, h, ST);
    await h.click('[data-v="clienti"]', 900); await h.click("#c-add", 900); await h.snap(1);
    await h.type("#cf-name", "Ospedale San Carlo SpA"); await h.type("#cf-city", "Monza");
    await h.point("#cf-sys"); await p.selectOption("#cf-sys", "Halo"); await h.cap("Scegli dove vanno i suoi ticket: ITSM o Halo", 2000); await h.snap(2);
    await h.type("#cf-dom", "ospedalesancarlo.it"); await h.cap("Il dominio fa riconoscere da sole le mail del cliente", 2200); await h.snap(3); await h.hide();
    await h.type('#cf-contacts .crow [data-k="n"]', "Luca Verdi"); await h.type('#cf-contacts .crow [data-k="mail"]', "l.verdi@ospedalesancarlo.it"); await h.type('#cf-contacts .crow [data-k="tel"]', "+39 333 1234567"); await h.snap(4);
    await h.cap("Con il telefono compare il pulsante WhatsApp", 1800); await h.hide();
    await h.click('#ed-form button[type="submit"]', 1300);
    await h.point("tbody tr:last-child .wa"); await h.cap("Il cliente è in elenco, con logo e WhatsApp a un tocco", 3200); await h.snap(5);
    await finish(ctx, p, file, 1.5);
  },
  async riconoscimento(browser, n, file) {
    const { ctx, p } = await newPage(browser, file); const h = H(p);
    await p.goto(ST + "/admin/"); await h.title("Tutorial " + n + " · Console", "Regolare il riconoscimento delle mail");
    await adminLogin(p, h, ST);
    await h.click('[data-v="regole"]', 900); await h.point(".rules"); await h.cap("Le regole si provano in ordine: la prima che trova ticket o cliente decide", 3400); await h.snap(1);
    await h.click('[data-r="4"]', 900); await h.cap("Spegni una regola con il suo interruttore, per esempio il dominio", 2600); await h.snap(2); await h.click('[data-r="4"]', 800);
    await h.point(".kv"); await h.cap("Sotto: indirizzo di raccolta e intestazioni usate dall'app", 2400); await h.snap(3);
    await h.click('[data-v="collegamenti"]', 900); await h.cap("In Collegamenti lo stato di ITSM, Halo e Office 365", 2400); await h.snap(4); await h.click("[data-t]", 1400);
    await h.click('[data-v="posta"]', 900); await h.click('tr[data-m="1"]', 1000); await h.point(".steps"); await h.cap("In ogni mail vedi quali regole l'hanno riconosciuta", 3200); await h.snap(5);
    await finish(ctx, p, file, 1.5);
  },
  async whatsapp(browser, n, file) {
    const { ctx, p } = await newPage(browser, file); const h = H(p);
    await p.goto(BE + "/app/"); await h.title("Tutorial " + n + " · App del tecnico", "Inoltrare un messaggio WhatsApp del cliente");
    await appLogin(p, h, false);
    await h.cap("Il cliente ha scritto su WhatsApp: tieni premuto il messaggio e tocca Copia", 3000);
    await h.click('[data-tab="inoltra"]'); await h.cap("In Ticket Farm tocca Inoltra e incolla il messaggio", 1800);
    await h.paste("#f-paste", "Buongiorno, l'analizzatore stamattina segna valori di grasso troppo alti\nabbiamo già rifatto la calibrazione ma niente\nriuscite a passare oggi?"); await h.snap(2);
    await h.cap("Tocca il ticket aperto del cliente", 1500); await h.click('[data-t="Tck #714139"]', 1000); await h.snap(3);
    await h.cap("Indica quando è arrivato il messaggio", 1400); await h.click('[data-ago="60"]', 800); await h.snap(4);
    await h.cap("Se serve, scrivi una nota per l'ufficio", 1200); await h.type("#f-note", "Passo io alle 14"); await h.snap(5);
    await h.point(".mailprev"); await h.cap("Ecco la mail che parte: dalla tua casella a support@, con il ticket nell'intestazione", 3600); await h.snap(6);
    await h.hide(); await h.click("#f-send", 1500);
    await h.cap("Inviato: il messaggio è nella conversazione del ticket", 3000);
    await h.hide(); await adminLogin(p, h, BE);
    await h.click('[data-v="posta"]', 900); await h.click("tr[data-m]", 1000); await h.snap(7);
    await h.cap("In console la mail è già in Posta in arrivo, riconosciuta sul ticket giusto", 4200);
    await finish(ctx, p, file, 1.5);
  },
  async mail(browser, n, file) {
    const { ctx, p } = await newPage(browser, file); const h = H(p);
    await p.goto(BE + "/app/"); await h.title("Tutorial " + n + " · App del tecnico", "Inoltrare una mail arrivata alla casella personale");
    await appLogin(p, h, false);
    await h.cap("Copia tutta la mail del cliente, comprese le righe Da, Inviato e Oggetto", 3000);
    await h.click('[data-tab="inoltra"]');
    await h.paste("#f-paste", "Da: Marco Rossi <m.rossi@caseificiovalle.ch>\nInviato: lunedì 9 novembre 2026 07:40\nA: mb.privato@gmail.com\nOggetto: Analizzatore latte\n\nBuongiorno, anche oggi l'analizzatore dà letture sballate. Riuscite a passare in giornata?\n\nMarco Rossi\nCaseificio Valle SA");
    await h.cap("L'app legge mittente, ora e oggetto e riconosce il cliente dal dominio della mail", 3600); await h.snap(2);
    await h.point("#pick"); await h.cap("Cliente e ticket sono già compilati: controlla e basta", 2600); await h.snap(3);
    await h.point("#dest"); await wait(1200); await h.snap(4);
    await h.hide(); await h.click("#f-send", 1500);
    await h.cap("Inviato: la mail del cliente è nella conversazione del ticket", 3200); await h.snap(5);
    await finish(ctx, p, file, 1.5);
  },
  async rispondi(browser, n, file) {
    const { ctx, p } = await newPage(browser, file); const h = H(p);
    await p.goto(BE + "/app/"); await h.title("Tutorial " + n + " · App del tecnico", "Rispondere al cliente e aggiornare il ticket");
    await appLogin(p, h, false);
    await h.point("#s-messaggi .item"); await h.cap("Il tag «da leggere» indica le conversazioni con novità", 2400); await h.snap(1);
    await h.click("#s-messaggi .item", 1200);
    await h.point(".copybox"); await h.cap("Ticket Farm propone il testo da mandare al cliente", 2600); await h.snap(2);
    await h.point(".copybox .wa"); await h.cap("«Apri chat cliente» apre WhatsApp con il testo già scritto", 3000); await h.snap(3);
    await h.click(".copybox [data-copy]", 900); await h.cap("Oppure «Copia negli appunti» e incollalo nella chat", 2200);
    await h.hide(); await h.type("#c-text", "Confermato con la cliente: passo domani alle 9");
    await h.click("#c-send", 1500); await h.cap("Per l'ufficio: scrivi qui e tocca Invia, parte una mail collegata al ticket", 3200); await h.snap(5);
    await h.hide(); await h.click("#c-back", 800); await h.click('[data-tab="clienti"]', 900);
    await h.point("#s-clienti .wa"); await h.cap("In Clienti il pulsante verde apre WhatsApp con il cliente", 3000);
    await finish(ctx, p, file, 1.5);
  },
  async verifica(browser, n, file) {
    const { ctx, p } = await newPage(browser, file); const h = H(p);
    await p.goto(ST + "/admin/"); await h.title("Tutorial " + n + " · Console", "Sistemare le mail da verificare");
    await adminLogin(p, h, ST);
    await h.point(".panel"); await h.cap("Nel cruscotto il riquadro Da verificare mostra le mail senza ticket né cliente", 3200); await h.snap(1);
    await h.click('[data-v="posta"]'); await h.click('[data-f="warn"]', 900); await h.snap(2);
    await h.click('tr[data-m="4"]', 1000); await h.cap("A destra: mittente, intestazioni e i passaggi del riconoscimento", 3000); await h.snap(3);
    await h.point("#fx-client"); await h.cap("Scegli il cliente giusto", 1400);
    await p.selectOption("#fx-client", "far"); await wait(900); await h.snap(4);
    await h.cap("Apri il ticket: finisce nel sistema del cliente e il tecnico lo vede nell'app", 2200);
    await h.click("#fx-go", 1500); await h.hide(); await h.snap(5);
    await h.click('[data-v="ticket"]', 1000); await h.cap("Il nuovo ticket è in cima all'elenco", 3000); await h.snap(6);
    await finish(ctx, p, file, 1.5);
  },
  async telefono(browser, n, file) {
    const { ctx, p } = await newPage(browser, file); const h = H(p);
    await p.goto(ST + "/admin/"); await h.title("Tutorial " + n + " · Console", "Aprire un ticket per una richiesta al telefono");
    await adminLogin(p, h, ST);
    await h.click('[data-v="ticket"]'); await h.cap("Un cliente chiama: in Ticket tocca Nuovo ticket", 1800);
    await h.click("#t-new", 900); await h.snap(2);
    await h.point("#nt-client"); await p.selectOption("#nt-client", "far"); await h.cap("Scegli il cliente: la console dice se va in ITSM o in Halo", 2600); await h.snap(3);
    await h.point("#nt-tech"); await p.selectOption("#nt-tech", "MB"); await wait(700);
    await h.type("#nt-title", "Bilancia analitica: non si accende");
    await h.click("#nt-urg", 600); await h.snap(4);
    await h.click("#nt-go", 1300); await h.cap("Il ticket è aperto, con il suo numero, e il tecnico lo vede nell'app", 3400); await h.snap(5);
    await finish(ctx, p, file, 1.5);
  },
};

function startBackend() {
  fs.rmSync(path.join(ROOT, "backend/data"), { recursive: true, force: true });
  const env = { ...process.env, PORT: "8201", MODE: "demo", ADMIN_PASSWORD: "", SECRET: "registrazione" };
  return spawn(process.execPath, ["server.js"], { cwd: path.join(ROOT, "backend"), env, stdio: "ignore" });
}
function startStatic() {
  const dir = path.join(TMP, "site"); fs.mkdirSync(path.join(dir, "admin"), { recursive: true });
  fs.cpSync(path.join(ROOT, "backend/admin"), path.join(dir, "admin"), { recursive: true });
  return http.createServer((q, r) => {
    let f = path.join(dir, decodeURIComponent(q.url.split("?")[0])); if (f.endsWith("/")) f += "index.html";
    if (!f.startsWith(dir) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    const t = { ".html": "text/html", ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4" }[path.extname(f)] || "application/octet-stream";
    r.writeHead(200, { "Content-Type": t }); fs.createReadStream(f).pipe(r);
  }).listen(8202);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const which = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : ORDER.map((_, i) => i + 1);
  const st = startStatic();
  const browser = await chromium.launch();
  try {
    for (const n of which) {
      const be = startBackend(); await wait(1200);
      const id = ORDER[n - 1]; console.log("Video " + n + " · " + id);
      CUR = n + "-" + id; fs.mkdirSync(SHOTS, { recursive: true });
      for (const f of fs.readdirSync(SHOTS)) if (f.startsWith(CUR + "-")) fs.unlinkSync(path.join(SHOTS, f));
      try { await VIDEOS[id](browser, n, n + "-" + id); } finally { be.kill(); await wait(300); }
    }
  } finally {
    await browser.close(); st.close();
    fs.rmSync(path.join(ROOT, "backend/data"), { recursive: true, force: true }); fs.rmSync(path.join(ROOT, "backend/outbox"), { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });

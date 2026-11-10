# Ticket Farm

Ticket Farm raccoglie in un solo posto le richieste dei clienti, anche quelle che arrivano ai recapiti **privati** dei tecnici (WhatsApp sul numero personale, mail sulla casella personale).

- **App del tecnico** (`app/`): il tecnico incolla il messaggio del cliente, sceglie il ticket o il cliente e invia. L'app **scrive** mandando una mail dalla casella del tecnico a `support@efuture.it` e **legge** dal backend.
- **Backend** (`backend/`): legge ticket, clienti e contatti da **ITSM**, **Halo** e **Office 365**, prepara e spedisce le mail, e ha la **console dell'ufficio** (`/admin`).

```
Scrive:  App  →  mail a support@efuture.it  →  ITSM / Halo
Legge:   App  ←  Backend  ←  database e API di ITSM, Halo, Office 365
```

## Come viene riconosciuto il ticket

È lo stesso meccanismo che ITSM usa già con le mail dei clienti:

| Caso | Oggetto | Intestazioni |
|---|---|---|
| Ticket già aperto | `Re: Tck #714139 - titolo` | `In-Reply-To` e `References` = identificativo dell'ultima mail mandata da ITSM per quel ticket |
| Richiesta nuova | `Messaggio WhatsApp - Nome cliente` | nessun riferimento; il cliente è in `X-TicketFarm-Cliente` e `X-TicketFarm-Cliente-Id` |

Sempre presenti: `X-TicketFarm-Tecnico`, `X-TicketFarm-Ora-Messaggio` (ora in cui il cliente ha scritto), `X-TicketFarm-Origine`.

> **Da decidere:** nella richiesta nuova il mittente è il tecnico, quindi oggi ITSM attribuirebbe il ticket al tecnico. Serve che ITSM (o il backend) legga `X-TicketFarm-Cliente-Id` e assegni il ticket al cliente giusto.

## Provarlo sul proprio computer

Serve Node.js 20 o più recente.

```bash
cd backend
npm install
npm start
```

- Console: <http://localhost:8080/admin/>
- App: <http://localhost:8080/app/>
- Accesso di prova: `mb@efuture.it`, codice `123456`.

In modalità prova (`MODE=demo`) i dati sono di esempio e **le mail non partono**: vengono salvate come file `.eml` in `backend/outbox/`, così si può vedere esattamente cosa riceverebbe support@.

Test automatici: `cd backend && npm test`.

## Installare l'app sul telefono

L'app è una **web app installabile** (PWA): niente App Store, si installa dal browser. È servita dal backend stesso all'indirizzo `/app/`, per esempio `https://ticketfarm.efuture.it/app/`, e lì si collega da sola al backend. Il repository può quindi restare **privato**.

1. Metti online il backend (sezione sotto) con un indirizzo **https**.
2. Sul telefono del tecnico apri `https://<indirizzo del backend>/app/`:
   - **Android (Chrome):** menu ⋮ → **Installa app**. Dopo l'installazione, Ticket Farm compare anche nel menu **Condividi** per i testi.
   - **iPhone (Safari):** pulsante Condividi → **Aggiungi alla schermata Home**.
3. Il tecnico accede con la sua mail e il codice che gli dai (vedi *Aggiungere i tecnici*).

I tecnici **non** hanno bisogno di un account GitHub: GitHub serve solo a chi lavora sul codice.

**Versione di prova pubblica:** app <https://marraliefuture.github.io/tms_farm/> e console <https://marraliefuture.github.io/tms_farm/admin/> (GitHub Pages, dati di esempio, nessuna mail spedita). Da PC con Chrome o Edge e da Android propone l'installazione.

Per una prova veloce senza backend si può aprire `app/index.html` da un piccolo server: con `backendUrl` vuoto in `app/config.js` l'app usa dati di esempio e non manda mail.

## Online in pochi minuti con Render (gratis)

1. Apri <https://render.com/deploy?repo=https://github.com/marraliEfuture/tms_farm> e accedi con GitHub.
2. Render legge `render.yaml`: scegli una password per la console (`ADMIN_PASSWORD`) e conferma con **Deploy Blueprint**.
3. Dopo 3-5 minuti il servizio è su `https://ticketfarm-xxxx.onrender.com`:
   - app: `…/app/` (prova: `mb@efuture.it`, codice `123456`)
   - console: `…/admin/` (utente `admin`, la password scelta)

Piano gratuito: si addormenta dopo 15 minuti senza visite (il primo accesso dopo la pausa impiega circa un minuto) e i dati di prova si azzerano a ogni riavvio. Ogni modifica salvata su GitHub viene pubblicata da sola.

## Mettere online il backend

**Server Linux senza Docker:** segui [`deploy/LEGGIMI.md`](deploy/LEGGIMI.md). Uno script installa il servizio systemd, e ci sono gli esempi per nginx e Apache.

In alternativa, con Docker (dalla cartella `backend`, che usa anche `app/`):

```bash
cd backend
cp .env.example .env      # poi compila .env
docker compose up -d --build
```

Il backend ascolta sulla porta 8080: va esposto in **https** (per esempio `https://ticketfarm.efuture.it`) tramite il proxy già usato per gli altri servizi. Indirizzi:

- `/app/` app dei tecnici
- `/admin/` console dell'ufficio (utente e password da `.env`)

Cosa compilare in `.env`:

| Voce | A cosa serve |
|---|---|
| `SECRET` | firma degli accessi dei tecnici (stringa lunga e casuale) |
| `SUPPORT_ADDRESS` | dove l'app manda le mail (`support@efuture.it`) |
| `APP_URL` | indirizzo dell'app, di solito `https://<backend>/app/` (serve per il collegamento nella console) |
| `ADMIN_USER`, `ADMIN_PASSWORD` | accesso alla console `/admin` |
| `MODE` | `demo` per provare, `live` per usare i dati veri e spedire |
| `SMTP_*` | server di posta da cui partono le mail. Deve permettere di spedire **con mittente la casella del tecnico** (relay autorizzato o "Send As"). Se `SMTP_HOST` è vuoto le mail restano in `outbox/` |
| `HALO_*` | API di Halo (client id e secret, tipo "client credentials") |
| `ITSM_*` | API di ITSM: vedi `backend/src/connectors/itsm.js` |
| `GRAPH_*` | Office 365: app registrata in Entra ID con permesso `Contacts.Read` |

### Aggiungere i tecnici

```bash
cd backend
npm run codice -- mario.rossi@efuture.it "Mario Rossi" MR Sud
```

Il comando stampa il codice di accesso da dare al tecnico: viene mostrato una sola volta, nel file `data/tecnici.json` resta solo la sua impronta.

## Loghi dei clienti

Il logo di ogni cliente si ricava dal dominio della sua mail (per esempio `@caseificiovalle.ch`): il backend scarica una volta l'icona del sito tramite il servizio pubblico di Google (`google.com/s2/favicons`) e la tiene in `backend/data/logos/` per 30 giorni. Se il sito non ha un'icona compaiono le iniziali su un colore fisso. Google vede quindi i domini dei clienti, non altri dati.

## Cosa manca per l'uso reale

- **ITSM:** il collegamento si aspetta tre letture (clienti, ticket aperti, identificativo dell'ultima mail di un ticket). Vanno adattate alle API o al database reali di itsm.efuture.it in `backend/src/connectors/itsm.js`.
- **Halo:** controllare i nomi dei campi con la vostra installazione; manca il modo di leggere l'identificativo dell'ultima mail mandata da Halo (senza, il ticket si riconosce solo dall'oggetto).
- **Assegnazione del cliente nelle richieste nuove** (vedi sopra).
- **Aggiornamenti verso il tecnico:** oggi l'app mostra le mail inviate e le conferme; le risposte e i cambi di stato letti da ITSM e Halo sono il passo successivo.
- **Lettura della casella support@:** la console mostra le mail mandate dall'app; leggere anche quelle in arrivo direttamente dai clienti richiede l'accesso alla casella.

## Struttura

```
app/                  web app del tecnico (servita dal backend in /app/)
  index.html          tutta l'app
  config.js           indirizzo del backend (vuoto = prova)
  manifest.webmanifest, sw.js, icons/   installazione sul telefono
deploy/               installazione su server Linux (systemd, nginx, Apache)
backend/
  server.js           API e console
  admin/index.html    console dell'ufficio
  src/mail.js         costruzione e invio della mail
  src/recognize.js    regole di riconoscimento
  src/connectors/     ITSM, Halo, Office 365, dati di prova
  scripts/codice.js   aggiunge un tecnico
  test/               test automatici
```

## Lavorare con il repository privato

1. Su GitHub apri il repository → **Settings → General → Danger Zone → Change visibility → Make private**.
2. **Settings → Collaborators → Add people**: scrivi l'utente GitHub o la mail della persona. Riceve un invito e, quando lo accetta, vede il repository. Nessun altro lo vede.
3. Per dare permessi diversi (solo lettura, scrittura, amministrazione) crea un'**organizzazione** GitHub gratuita (per esempio "efuture"), sposta lì il repository (**Settings → Transfer**) e usa i **Team**.

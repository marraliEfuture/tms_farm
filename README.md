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

Serve Node.js 18 o più recente.

```bash
cd backend
npm install
npm start
```

- Console: <http://localhost:8080/admin/>
- App: apri `app/index.html` con un piccolo server (per esempio `npx serve app`) e in `app/config.js` metti `backendUrl: "http://localhost:8080"`.
- Accesso di prova: `mb@efuture.it`, codice `123456`.

In modalità prova (`MODE=demo`) i dati sono di esempio e **le mail non partono**: vengono salvate come file `.eml` in `backend/outbox/`, così si può vedere esattamente cosa riceverebbe support@.

Test automatici: `cd backend && npm test`.

## Installare l'app sul telefono

L'app è una **web app installabile** (PWA): niente App Store, si installa dal browser.

1. Pubblica l'app su GitHub Pages (una volta sola): nel repository, **Settings → Pages → Source: GitHub Actions**. A ogni modifica di `app/` il workflow `Pubblica app su GitHub Pages` la aggiorna. L'indirizzo sarà `https://marraliefuture.github.io/tms_farm/`.
2. Sul telefono apri quell'indirizzo:
   - **Android (Chrome):** menu ⋮ → **Installa app**. Dopo l'installazione, Ticket Farm compare anche nel menu **Condividi** per i testi.
   - **iPhone (Safari):** pulsante Condividi → **Aggiungi alla schermata Home**.
3. Finché `app/config.js` ha `backendUrl` vuoto, l'app è in **modalità prova** con dati di esempio. Quando il backend è online, metti lì il suo indirizzo (deve essere **https**).

## Mettere online il backend

Sul server di Efuture, con Docker:

```bash
cd backend
cp .env.example .env      # poi compila .env
docker compose up -d --build
```

Il backend ascolta sulla porta 8080: va esposto in **https** (per esempio `https://ticketfarm.efuture.it`) tramite il proxy già usato per gli altri servizi.

Cosa compilare in `.env`:

| Voce | A cosa serve |
|---|---|
| `SECRET` | firma degli accessi dei tecnici (stringa lunga e casuale) |
| `SUPPORT_ADDRESS` | dove l'app manda le mail (`support@efuture.it`) |
| `APP_URL` | indirizzo dell'app su GitHub Pages |
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

## Cosa manca per l'uso reale

- **ITSM:** il collegamento si aspetta tre letture (clienti, ticket aperti, identificativo dell'ultima mail di un ticket). Vanno adattate alle API o al database reali di itsm.efuture.it in `backend/src/connectors/itsm.js`.
- **Halo:** controllare i nomi dei campi con la vostra installazione; manca il modo di leggere l'identificativo dell'ultima mail mandata da Halo (senza, il ticket si riconosce solo dall'oggetto).
- **Assegnazione del cliente nelle richieste nuove** (vedi sopra).
- **Aggiornamenti verso il tecnico:** oggi l'app mostra le mail inviate e le conferme; le risposte e i cambi di stato letti da ITSM e Halo sono il passo successivo.
- **Lettura della casella support@:** la console mostra le mail mandate dall'app; leggere anche quelle in arrivo direttamente dai clienti richiede l'accesso alla casella.

## Struttura

```
app/                  web app del tecnico (pubblicata su GitHub Pages)
  index.html          tutta l'app
  config.js           indirizzo del backend (vuoto = prova)
  manifest.webmanifest, sw.js, icons/   installazione sul telefono
backend/
  server.js           API e console
  admin/index.html    console dell'ufficio
  src/mail.js         costruzione e invio della mail
  src/recognize.js    regole di riconoscimento
  src/connectors/     ITSM, Halo, Office 365, dati di prova
  scripts/codice.js   aggiunge un tecnico
  test/               test automatici
```

# Mettere Ticket Farm su un server Linux (senza Docker)

Serve: un server Linux con systemd, accesso `sudo`, un nome come `ticketfarm.efuture.it` che punta al server.

## 1. Node.js 20 di sistema

Il Node di Ubuntu è troppo vecchio (12). Installa Node 20 dal repository ufficiale NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v      # deve dire v20.…
```

Non usare nvm sul server: installa Node nella cartella di un utente e il servizio non lo trova.

## 2. Codice

```bash
sudo git clone https://github.com/marrali4future/tms_farm /opt/tms_farm
```

Il repository è privato: serve un token GitHub con permesso di lettura (Contents: Read) su tms_farm.

## 3. Installazione

```bash
cd /opt/tms_farm
sudo bash deploy/installa.sh
```

La prima volta crea `backend/.env` con un `SECRET` casuale. Compilalo:

```bash
sudo nano /opt/tms_farm/backend/.env
```

Almeno `ADMIN_PASSWORD` e `APP_URL=https://ticketfarm.efuture.it/app/`. Lascia `MODE=demo` finché non sono pronti SMTP e collegamenti. Poi rilancia `sudo bash deploy/installa.sh`.

## 4. https

Con nginx usa `deploy/nginx.conf`, con Apache `deploy/apache.conf` (cambia il nome del server). Il certificato gratuito si ottiene con certbot.

## 5. Tecnici

```bash
cd /opt/tms_farm/backend
sudo -u ticketfarm node scripts/codice.js mario.rossi@efuture.it "Mario Rossi" MR Sud
```

Stampa il codice da dare al tecnico. Il tecnico apre `https://ticketfarm.efuture.it/app/` sul telefono e installa l'app.

## Comandi utili

| Cosa | Comando |
|---|---|
| Stato | `systemctl status ticketfarm` |
| Log in diretta | `journalctl -u ticketfarm -f` |
| Riavvio | `sudo systemctl restart ticketfarm` |
| Aggiornamento | `cd /opt/tms_farm && sudo git pull && sudo bash deploy/installa.sh` |

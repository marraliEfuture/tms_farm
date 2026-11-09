#!/usr/bin/env bash
# Installa o aggiorna il backend Ticket Farm su un server Linux con systemd.
# Uso (dalla cartella del repository clonato in /opt/tms_farm):
#   sudo bash deploy/installa.sh
# Si può rilanciare a ogni aggiornamento: non sovrascrive .env né i dati.
set -euo pipefail

DIR=/opt/tms_farm
[ "$(id -u)" -eq 0 ] || { echo "Lancialo con sudo."; exit 1; }
[ -d "$DIR/backend" ] || { echo "Non trovo $DIR/backend: clona prima il repository in $DIR."; exit 1; }

NODE_BIN=$(command -v node || true)
[ -n "$NODE_BIN" ] || { echo "Node.js non trovato. Installa Node 20 (vedi deploy/LEGGIMI.md)."; exit 1; }
VER=$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')
[ "$VER" -ge 20 ] || { echo "Serve Node 20 o più recente, trovato $("$NODE_BIN" -v)."; exit 1; }
case "$NODE_BIN" in /root/*|/home/*) echo "Node è in $NODE_BIN (nvm): il servizio non può leggerlo. Installa Node 20 di sistema (vedi deploy/LEGGIMI.md)."; exit 1;; esac

id ticketfarm >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin ticketfarm

cd "$DIR/backend"
sudo -u ticketfarm true 2>/dev/null || true
npm install --omit=dev --no-audit --no-fund
mkdir -p data outbox
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s/^SECRET=.*/SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '/+=')/" .env
  echo ">> Creato backend/.env: compilalo (ADMIN_PASSWORD, SMTP, Halo, ITSM, Office 365) e poi rilancia questo script."
fi
chown -R ticketfarm:ticketfarm data outbox
chown root:ticketfarm .env && chmod 640 .env

sed "s#NODE_BIN#$NODE_BIN#" "$DIR/deploy/ticketfarm.service" > /etc/systemd/system/ticketfarm.service
systemctl daemon-reload
systemctl enable ticketfarm >/dev/null
systemctl restart ticketfarm
sleep 2
systemctl --no-pager --lines=5 status ticketfarm || true
echo
echo "Backend su http://localhost:8080  ·  app: /app/  ·  console: /admin/"
echo "Ora pubblicalo in https con nginx o Apache (esempi in deploy/)."

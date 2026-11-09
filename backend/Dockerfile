# Costruire dalla cartella principale del repository: docker compose (in backend/) lo fa da solo.
FROM node:20-alpine
WORKDIR /srv/backend
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./
COPY app/ /srv/app/
ENV PORT=8080
EXPOSE 8080
VOLUME ["/srv/backend/data", "/srv/backend/outbox"]
CMD ["node", "server.js"]

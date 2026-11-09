FROM node:20-alpine
WORKDIR /srv
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=8080
EXPOSE 8080
VOLUME ["/srv/data", "/srv/outbox"]
CMD ["node", "server.js"]

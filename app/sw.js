/* Service worker: tiene in cache i file dell'app così si apre anche senza rete.
   Le chiamate al backend (/api/...) passano sempre dalla rete. */
const VERSION = "tf-33";
const FILES = ["./", "index.html", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "media/logo-ticketfarm.mp4", "media/poster.jpg", "vendor/qrcode-generator-2.0.4.js", "vendor/simplewebauthn-browser-14.0.0.umd.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.includes("/api/") || url.origin !== location.origin) return;
  /* prima la rete, così gli aggiornamenti arrivano subito; senza rete la copia in cache */
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, {ignoreSearch: true})));
});

/* notifiche push: nuova risposta o nuovo ticket; il pallino sull'icona mostra le conversazioni da leggere */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : "" }; }
  const jobs = [self.registration.showNotification(d.title || "Ticket Farm", {
    body: d.body || "Hai un nuovo messaggio", icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    tag: d.tag || "tf", renotify: true, data: { ticket: d.ticket || "" } })];
  if (typeof d.badge === "number" && self.navigator && "setAppBadge" in self.navigator) jobs.push(d.badge ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge());
  e.waitUntil(Promise.all(jobs).catch(() => {}));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const t = (e.notification.data || {}).ticket || "", url = new URL("./" + (t ? "#t=" + encodeURIComponent(t) : ""), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.postMessage({ open: t }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});

// 홈 화면 앱용 서비스 워커: 앱 화면(index.html·아이콘·글꼴)을 기기에 보관해 인터넷이 없어도 열리게 함.
// 앱 화면은 "먼저 서버에서 받고, 안 되면 보관본" → 온라인이면 늘 최신 버전.
// 목록 데이터(/api/...)는 절대 보관하지 않음.
const CACHE = "basket-app-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) return;
  const font = /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !font) return;
  if (font) {
    // 글꼴은 바뀌지 않으므로 보관본 우선
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  const isPage = req.mode === "navigate";
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(isPage ? "/" : req, copy)); }
    return res;
  }).catch(() => caches.match(isPage ? "/" : req, { ignoreSearch: isPage }).then(hit => hit || Response.error())));
});

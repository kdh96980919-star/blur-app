const CACHE_NAME = "blur-service-v14";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./backend.js",
  "./config.js",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/blur1.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; // supabase·esm.sh·폰트는 SW 개입 없음
  // 앱 파일은 네트워크 우선 — 배포가 즉시 반영되고, 오프라인이면 캐시로 대체.
  // cache: "no-cache"로 브라우저 휴리스틱 캐시를 우회해 항상 서버와 재검증한다
  // (이게 없으면 새로고침해도 이전 CSS/JS가 보이는 문제가 생긴다)
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});

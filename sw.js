const CACHE_NAME = "blur-service-v17";
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

// 웹 푸시 수신 — notify Edge Function이 보낸 페이로드로 잠금화면 알림을 띄운다 (migration-11)
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  // 제목은 서버가 빈 문자열을 보낼 수 있다(iOS "from blur" 중복 방지) — ??로 빈 문자열을 보존
  const title = data.title ?? "blur";
  const options = {
    body: data.body || "",
    icon: "./assets/icon.svg",
    badge: "./assets/icon.svg",
    tag: data.tag || "blur-notif",
    data: { url: data.url || "./" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 알림 탭 → 열려 있는 앱으로 포커스, 없으면 새로 연다
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
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

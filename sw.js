const CACHE_NAME = "blur-service-v27";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./backend.js",
  "./config.js",
  "./manifest.webmanifest",
  "./assets/favicon-32.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-180.png",
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
    icon: "./assets/icon-192.png",
    badge: "./assets/icon-192.png",
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

// esm.sh는 Supabase 클라이언트 라이브러리를 런타임 import하는 CDN — 오프라인에서 이게 캐시돼
// 있지 않으면 app.js의 import가 실패해 앱이 아예 안 뜬다(흰 화면). 그래서 라이브러리 CDN만
// 캐시한다. Supabase API 호출(*.supabase.co, REST/auth/realtime 데이터)은 절대 캐시하면 안 된다.
function isLibraryCdn(url) {
  return url.hostname === "esm.sh" || url.hostname.endsWith(".esm.sh");
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (url.origin === location.origin) {
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
    return;
  }

  // 라이브러리 CDN(esm.sh): 캐시 우선 + 백그라운드 갱신(stale-while-revalidate).
  // 온라인에서 한 번 로드되면 캐시에 남아 오프라인에서도 앱이 부팅돼 오프라인 화면을 띄울 수 있다.
  if (isLibraryCdn(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }
  // 그 외 크로스 오리진(Supabase API 등)은 SW 개입 없음 — 항상 네트워크로
});

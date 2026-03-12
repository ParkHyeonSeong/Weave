const CACHE_NAME = 'weave-offline-v1';
const OFFLINE_URL = '/offline.html';

// 설치: 오프라인 페이지 캐시
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

// 활성화: 이전 버전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: navigation 실패 시 오프라인 페이지 반환
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
  }
});

// Push: 백그라운드 알림 수신
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Weave';
  const options = {
    body: data.body || '',
    icon: '/icons/weave-192.png',
    badge: '/icons/weave-192.png',
    data: { url: data.url || '/' },
    tag: `weave-${Date.now()}`,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 알림 클릭: 해당 페이지로 이동
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

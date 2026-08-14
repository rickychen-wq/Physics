/* ============================================================
 *  TPS 請假加班系統 — Service Worker
 *  背景待命的程式，負責在手機上顯示通知。
 *  必須放在網站根目錄（跟 index.html 同一層）。
 * ============================================================ */

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: '請假加班系統', body: '', url: 'index.html', tag: 'tps' };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(self.registration.showNotification(data.title, {
    body:  data.body,
    icon:  'icon-192.png',
    badge: 'icon-192.png',
    data:  { url: data.url },
    vibrate: [80, 40, 80],
    tag: data.tag,          // 同 tag 會互相取代，避免洗版
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || 'index.html';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(target); } catch (e) {} }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

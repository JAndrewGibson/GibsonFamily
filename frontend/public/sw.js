/* GibsonFamily Hub — Mobile Push & Notification Service Worker */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'GibsonFamily Hub',
    body: 'You have a new partner update.',
    link_tab: 'overview',
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag || `gibson-push-${Date.now()}`,
      renotify: true,
      vibrate: [180, 90, 180],
      data: {
        link_tab: payload.link_tab || 'overview',
        url: '/',
      },
    })
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SHOW_NOTIFICATION' && data.title) {
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body || '',
        tag: data.tag || `gibson-notif-${Date.now()}`,
        renotify: true,
        vibrate: [180, 90, 180],
        data: {
          link_tab: data.link_tab || 'overview',
          url: '/',
        },
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetTab = event.notification.data?.link_tab || 'overview';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            link_tab: targetTab,
          });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
      return null;
    })
  );
});


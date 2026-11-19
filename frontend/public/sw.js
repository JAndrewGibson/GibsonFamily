/* GibsonFamily Hub — Mobile Push & Notification Service Worker */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function updateAppBadge(unreadCount) {
  if (typeof unreadCount !== 'number') return Promise.resolve();
  if (unreadCount > 0 && typeof self.registration.setAppBadge === 'function') {
    return self.registration.setAppBadge(unreadCount).catch(() => {});
  }
  if (unreadCount === 0 && typeof self.registration.clearAppBadge === 'function') {
    return self.registration.clearAppBadge().catch(() => {});
  }
  return Promise.resolve();
}

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

  const targetTab = payload.link_tab || 'overview';
  const notifPromise = self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    tag: payload.tag || `gibson-push-${Date.now()}`,
    renotify: true,
    vibrate: [180, 90, 180],
    actions: [{ action: 'open', title: 'Open' }],
    data: {
      link_tab: targetTab,
      url: `/?tab=${encodeURIComponent(targetTab)}`,
    },
  });

  event.waitUntil(Promise.all([notifPromise, updateAppBadge(payload.unread_count)]));
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SHOW_NOTIFICATION' && data.title) {
    const targetTab = data.link_tab || 'overview';
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        tag: data.tag || `gibson-notif-${Date.now()}`,
        renotify: true,
        vibrate: [180, 90, 180],
        actions: [{ action: 'open', title: 'Open' }],
        data: {
          link_tab: targetTab,
          url: `/?tab=${encodeURIComponent(targetTab)}`,
        },
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetTab = event.notification.data?.link_tab || 'overview';
  const targetUrl = event.notification.data?.url || `/?tab=${encodeURIComponent(targetTab)}`;

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
        return self.clients.openWindow(targetUrl);
      }
      return null;
    })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        let appServerKey = event.oldSubscription?.options?.applicationServerKey;
        if (!appServerKey) {
          const res = await fetch('/api/notifications/vapid-public-key', {
            credentials: 'include',
          });
          if (res.ok) {
            const data = await res.json();
            if (data.public_key) {
              const padding = '='.repeat((4 - (data.public_key.length % 4)) % 4);
              const b64 = (data.public_key + padding).replace(/-/g, '+').replace(/_/g, '/');
              const raw = atob(b64);
              const bytes = new Uint8Array(raw.length);
              for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
              appServerKey = bytes.buffer;
            }
          }
        }
        if (!appServerKey) return;

        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey,
        });
        await fetch('/api/notifications/push-subscribe', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'GibsonApp',
          },
          body: JSON.stringify({
            subscription: newSub.toJSON(),
            enabled: true,
          }),
        });
      } catch {
        // Ignore if user is logged out or push permission revoked
      }
    })()
  );
});

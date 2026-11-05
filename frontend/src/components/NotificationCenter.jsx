import React, { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, CheckCheck, Send, Smartphone, Trash2, X } from 'lucide-react';
import {
  apiFetch,
  getCookie,
  registerServiceWorker,
  setCookie,
  showMobileNativeNotification,
} from '../api';

export async function enableMobilePushSubscription() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    throw new Error(
      'Push notifications are not available in this browser view. On iPhone/iPad, tap Share → "Add to Home Screen" first.'
    );
  }

  const perm = await window.Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error('Notification permission was not granted. Please allow notifications in your browser settings.');
  }

  const reg = await registerServiceWorker();
  let subPayload = {};
  if (reg && reg.pushManager && typeof reg.pushManager.getSubscription === 'function') {
    try {
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        subPayload = existingSub.toJSON ? existingSub.toJSON() : {};
      }
    } catch {
      // Ignore if VAPID push server is not configured; SW showNotification still works
    }
  }

  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const isAndroid = /Android/i.test(navigator.userAgent || '');
  const deviceLabel = isIOS
    ? 'iPhone / iOS Device'
    : isAndroid
    ? 'Android Phone'
    : 'Mobile / Browser Device';

  const res = await apiFetch('/api/notifications/push-subscribe', {
    method: 'POST',
    body: JSON.stringify({
      subscription: subPayload,
      device_label: deviceLabel,
      enabled: true,
    }),
  });

  setCookie('gibson_push_enabled', '1');
  await showMobileNativeNotification(
    'GibsonFamily Push Enabled',
    'You will now receive instant mobile alerts for partner purchase requests & budget updates.',
    'overview'
  );
  return res;
}

export function MobilePushPromptBanner({ currentPartner }) {
  const [perm, setPerm] = useState(
    typeof window !== 'undefined' && 'Notification' in window
      ? window.Notification.permission
      : 'unsupported'
  );
  const [subscribed, setSubscribed] = useState(
    () => getCookie('gibson_push_enabled', '0') === '1'
  );
  const [dismissed, setDismissed] = useState(
    () => getCookie('gibson_push_prompt_dismissed', '0') === '1'
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    registerServiceWorker();
    apiFetch('/api/notifications/push-status')
      .then((res) => {
        if (res.subscribed) {
          setSubscribed(true);
          setCookie('gibson_push_enabled', '1');
        }
      })
      .catch(() => {});
  }, [currentPartner?.id]);

  if (dismissed) return null;
  if (perm === 'granted' && subscribed && !feedback) return null;

  const handleEnable = async () => {
    setBusy(true);
    setFeedback('');
    try {
      await enableMobilePushSubscription();
      setPerm(
        typeof window !== 'undefined' && 'Notification' in window
          ? window.Notification.permission
          : 'granted'
      );
      setSubscribed(true);
      setFeedback('Push notifications enabled! Tap "Test Alert" to try it.');
    } catch (err) {
      setPerm(
        typeof window !== 'undefined' && 'Notification' in window
          ? window.Notification.permission
          : 'unsupported'
      );
      setFeedback(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSendTest = async () => {
    setBusy(true);
    try {
      const res = await apiFetch('/api/notifications/push-test', { method: 'POST' });
      const notif = res.notification;
      if (notif) {
        await showMobileNativeNotification(notif.title, notif.message, notif.link_tab || 'overview');
      }
      setFeedback('Test push notification sent to your device!');
    } catch (err) {
      setFeedback(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    setCookie('gibson_push_prompt_dismissed', '1');
  };

  return (
    <div className="push-prompt-banner">
      <div className="push-prompt-main">
        <div className="push-prompt-icon">
          <BellRing size={20} />
        </div>
        <div className="push-prompt-copy">
          <strong>Enable Mobile Push Notifications</strong>
          <p>
            Get instant alerts on your phone when your partner submits a purchase request, marks an item{' '}
            <em>Under Review</em>, or updates the monthly budget.
          </p>
          {perm === 'unsupported' && (
            <small className="text-muted">
              On iPhone Safari: tap <strong>Share → Add to Home Screen</strong> to enable native iOS push alerts.
            </small>
          )}
          {feedback && <small className="push-prompt-feedback">{feedback}</small>}
        </div>
      </div>

      <div className="push-prompt-actions">
        {perm !== 'granted' || !subscribed ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleEnable}
            disabled={busy}
          >
            <Smartphone size={15} /> {busy ? 'Enabling...' : 'Enable Push Alerts'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleSendTest}
            disabled={busy}
          >
            <Send size={14} /> Send Test Alert
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={handleDismiss}
          title="Dismiss prompt"
        >
          <X size={15} /> Not Now
        </button>
      </div>
    </div>
  );
}

export default function NotificationCenter({ onNavigateTab, syncVersion }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [browserPerm, setBrowserPerm] = useState(
    typeof window !== 'undefined' && 'Notification' in window
      ? window.Notification.permission
      : 'unsupported'
  );
  const [pushSubscribed, setPushSubscribed] = useState(
    () => getCookie('gibson_push_enabled', '0') === '1'
  );
  const [pushStatusMsg, setPushStatusMsg] = useState('');
  const lastTopIdRef = useRef(null);
  const wrapperRef = useRef(null);

  const loadNotifications = async (triggerToast = false) => {
    try {
      const data = await apiFetch('/api/notifications');
      const list = data.notifications || [];
      setNotifications(list);
      setUnreadCount(data.unread_count || 0);

      if (list.length > 0) {
        const newest = list[0];
        if (
          triggerToast &&
          lastTopIdRef.current !== null &&
          newest.id > lastTopIdRef.current &&
          !newest.is_read
        ) {
          await showMobileNativeNotification(
            newest.title,
            newest.message,
            newest.link_tab || 'overview'
          );
        }
        lastTopIdRef.current = Math.max(...list.map((n) => n.id));
      }
    } catch {
      // Ignore polling errors when locked
    }
  };

  useEffect(() => {
    registerServiceWorker();
    loadNotifications(false);
    apiFetch('/api/notifications/push-status')
      .then((res) => {
        if (res.subscribed) {
          setPushSubscribed(true);
          setCookie('gibson_push_enabled', '1');
        }
      })
      .catch(() => {});

    const timer = setInterval(() => loadNotifications(true), 12000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
    const onSwMessage = (event) => {
      if (event.data?.type === 'NOTIFICATION_CLICK' && event.data?.link_tab) {
        onNavigateTab?.(event.data.link_tab);
      }
    };
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onSwMessage);
  }, [onNavigateTab]);

  useEffect(() => {
    if (syncVersion > 1) {
      loadNotifications(true);
    }
  }, [syncVersion]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleEnableMobilePush = async () => {
    setPushStatusMsg('');
    try {
      await enableMobilePushSubscription();
      setBrowserPerm(
        typeof window !== 'undefined' && 'Notification' in window
          ? window.Notification.permission
          : 'granted'
      );
      setPushSubscribed(true);
      setPushStatusMsg('Mobile push alerts enabled!');
    } catch (err) {
      setPushStatusMsg(err.message);
    }
  };

  const handleTestMobilePush = async () => {
    setPushStatusMsg('');
    try {
      const res = await apiFetch('/api/notifications/push-test', { method: 'POST' });
      if (res.notification) {
        await showMobileNativeNotification(
          res.notification.title,
          res.notification.message,
          res.notification.link_tab || 'overview'
        );
      }
      await loadNotifications(false);
      setPushStatusMsg('Test alert sent!');
    } catch (err) {
      setPushStatusMsg(err.message);
    }
  };

  const handleClickNotification = async (notif) => {
    if (!notif.is_read) {
      await apiFetch(`/api/notifications/${notif.id}/read`, { method: 'PUT' });
    }
    if (notif.link_tab) {
      onNavigateTab?.(notif.link_tab);
    }
    setOpen(false);
    await loadNotifications(false);
  };

  const handleMarkAllRead = async () => {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    await loadNotifications(false);
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    await apiFetch(`/api/notifications/${id}`, { method: 'DELETE' });
    await loadNotifications(false);
  };

  return (
    <div className="notif-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className="btn btn-secondary btn-sm notif-bell-btn"
        onClick={() => {
          setOpen(!open);
          if (!open) loadNotifications(false);
        }}
        title="Notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && <span className="notif-unread-badge">{unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown-card">
          <div className="notif-dropdown-header">
            <strong>Notifications ({unreadCount} unread)</strong>
            <div className="topbar-right">
              {browserPerm !== 'granted' || !pushSubscribed ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleEnableMobilePush}
                >
                  <Smartphone size={13} /> Enable Push
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleTestMobilePush}
                >
                  <Send size={13} /> Test Push
                </button>
              )}
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleMarkAllRead}
                >
                  <CheckCheck size={14} /> Mark all read
                </button>
              )}
            </div>
          </div>

          {pushStatusMsg && (
            <div className="notif-push-status-bar">
              <small>{pushStatusMsg}</small>
            </div>
          )}

          <div className="notif-list">
            {notifications.length === 0 ? (
              <div className="empty-state-box">
                <p className="text-muted">No notifications yet. You're all caught up!</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`notif-item ${n.is_read ? 'read' : 'unread'}`}
                  onClick={() => handleClickNotification(n)}
                >
                  <div className="notif-item-body">
                    <div className="notif-item-top">
                      <strong>{n.title}</strong>
                      {!n.is_read && <span className="notif-dot" />}
                    </div>
                    <p>{n.message}</p>
                    <small className="text-muted">{n.created_at?.slice(0, 16)}</small>
                  </div>
                  <button
                    type="button"
                    className="btn-icon-danger"
                    onClick={(e) => handleDelete(e, n.id)}
                    title="Dismiss notification"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

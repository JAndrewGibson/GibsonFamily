import React, { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Sparkles, Trash2 } from 'lucide-react';
import { apiFetch } from '../api';

export default function NotificationCenter({ onNavigateTab, syncVersion }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [browserPerm, setBrowserPerm] = useState(
    typeof window !== 'undefined' && 'Notification' in window
      ? window.Notification.permission
      : 'unsupported'
  );
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
          if (
            typeof window !== 'undefined' &&
            'Notification' in window &&
            window.Notification.permission === 'granted'
          ) {
            new window.Notification(newest.title, {
              body: newest.message,
            });
          }
        }
        lastTopIdRef.current = Math.max(...list.map((n) => n.id));
      }
    } catch {
      // Ignore polling errors when locked
    }
  };

  useEffect(() => {
    loadNotifications(false);
    const timer = setInterval(() => loadNotifications(true), 15000);
    return () => clearInterval(timer);
  }, []);

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

  const handleRequestBrowserPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const perm = await window.Notification.requestPermission();
      setBrowserPerm(perm);
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
              {browserPerm === 'default' && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleRequestBrowserPermission}
                >
                  Enable Desktop Alerts
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


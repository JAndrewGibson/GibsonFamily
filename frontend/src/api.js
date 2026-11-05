let memoryAuthToken = null;

export function setAuthToken(token) {
  memoryAuthToken = token || null;
}

export function getCookie(name, defaultValue = '') {
  if (typeof document === 'undefined') return defaultValue;
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)')
  );
  return match ? decodeURIComponent(match[1]) : defaultValue;
}

export function setCookie(name, value, days = 365) {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax${secure}`;
}

export function notifyLocalSync() {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel('gibson_sync');
      ch.postMessage({ type: 'MUTATION', ts: Date.now() });
      ch.close();
    }
  } catch {
    // ignore
  }
}

export async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (memoryAuthToken) {
    headers['Authorization'] = `Bearer ${memoryAuthToken}`;
  }

  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed with status ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const method = (options.method || 'GET').toUpperCase();
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    notifyLocalSync();
  }

  return data;
}

export function base64UrlToUint8Array(base64UrlString) {
  const padding = '='.repeat((4 - (base64UrlString.length % 4)) % 4);
  const base64 = (base64UrlString + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Registers a hardware/platform WebAuthn Passkey (navigator.credentials.create).
 */
export async function registerPasskeyForPartner(partnerId, deviceName) {
  if (!window.PublicKeyCredential || !navigator.credentials || !navigator.credentials.create) {
    throw new Error('WebAuthn Passkeys are not supported in this browser or non-HTTPS context.');
  }

  const options = await apiFetch('/api/auth/webauthn/register/options', {
    method: 'POST',
    body: JSON.stringify({ partner_id: partnerId }),
  });

  const publicKey = {
    ...options,
    challenge: base64UrlToUint8Array(options.challenge),
    user: {
      ...options.user,
      id: base64UrlToUint8Array(options.user.id),
    },
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({
      ...c,
      id: base64UrlToUint8Array(c.id),
    })),
  };

  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey });
  } catch (err) {
    throw new Error(
      err.name === 'NotAllowedError'
        ? 'Passkey registration was cancelled or declined on your device.'
        : `Passkey registration failed: ${err.message}`
    );
  }

  const credentialPayload = {
    id: cred.id,
    rawId: bufferToBase64Url(cred.rawId),
    type: cred.type,
    transports: cred.response.getTransports ? cred.response.getTransports() : ['internal'],
    response: {
      clientDataJSON: bufferToBase64Url(cred.response.clientDataJSON),
      attestationObject: bufferToBase64Url(cred.response.attestationObject),
    },
  };

  return apiFetch('/api/auth/webauthn/register/verify', {
    method: 'POST',
    body: JSON.stringify({
      partner_id: partnerId,
      device_name: deviceName || 'Device Passkey (Biometric / PIN)',
      credential: credentialPayload,
    }),
  });
}

/**
 * Authenticates or unlocks the screen using a WebAuthn Passkey (navigator.credentials.get).
 */
export async function authenticateWithPasskey(partnerId) {
  if (!window.PublicKeyCredential || !navigator.credentials || !navigator.credentials.get) {
    throw new Error('WebAuthn Passkeys are not supported in this browser.');
  }

  const options = await apiFetch('/api/auth/webauthn/authenticate/options', {
    method: 'POST',
    body: JSON.stringify({ partner_id: partnerId }),
  });

  if (!options.allowCredentials || options.allowCredentials.length === 0) {
    throw new Error('No Passkey is registered for this account yet. Sign in with your password first to enroll a Passkey.');
  }

  const publicKey = {
    challenge: base64UrlToUint8Array(options.challenge),
    rpId: options.rpId,
    timeout: options.timeout || 60000,
    userVerification: options.userVerification || 'preferred',
    allowCredentials: (options.allowCredentials || []).map((c) => ({
      ...c,
      id: base64UrlToUint8Array(c.id),
    })),
  };

  let assertion;
  try {
    assertion = await navigator.credentials.get({ publicKey });
  } catch (err) {
    throw new Error(
      err.name === 'NotAllowedError'
        ? 'Passkey verification was cancelled.'
        : `Passkey verification failed: ${err.message}`
    );
  }

  const assertionPayload = {
    id: assertion.id,
    rawId: bufferToBase64Url(assertion.rawId),
    type: assertion.type,
    response: {
      clientDataJSON: bufferToBase64Url(assertion.response.clientDataJSON),
      authenticatorData: bufferToBase64Url(assertion.response.authenticatorData),
      signature: bufferToBase64Url(assertion.response.signature),
    },
  };

  const res = await apiFetch('/api/auth/webauthn/authenticate/verify', {
    method: 'POST',
    body: JSON.stringify({ credential: assertionPayload }),
  });

  if (res.token) {
    setAuthToken(res.token);
  }
  return res;
}

/**
 * Registers the Service Worker (/sw.js) for mobile push notifications.
 */
export async function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch {
    return null;
  }
}

/**
 * Triggers a native notification on mobile (via ServiceWorkerRegistration.showNotification)
 * with graceful fallback to the desktop Notification constructor.
 */
export async function showMobileNativeNotification(title, body, linkTab = 'overview') {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (window.Notification.permission !== 'granted') {
    return false;
  }

  try {
    if ('serviceWorker' in navigator) {
      const reg = await registerServiceWorker();
      const activeReg = reg || (await navigator.serviceWorker.ready);
      if (activeReg && typeof activeReg.showNotification === 'function') {
        await activeReg.showNotification(title, {
          body: body || '',
          tag: `gibson-alert-${Date.now()}`,
          renotify: true,
          vibrate: [180, 90, 180],
          data: { link_tab: linkTab, url: '/' },
        });
        return true;
      }
    }
  } catch {
    // Fallback below
  }

  try {
    new window.Notification(title, { body: body || '' });
    return true;
  } catch {
    return false;
  }
}

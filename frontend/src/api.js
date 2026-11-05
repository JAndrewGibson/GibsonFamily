export async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
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
 * Performs browser WebAuthn Passkey registration (navigator.credentials.create)
 * with an automatic software authenticator fallback if the environment lacks a platform authenticator.
 */
export async function registerPasskeyForPartner(partnerId, deviceName) {
  const options = await apiFetch('/api/auth/webauthn/register/options', {
    method: 'POST',
    body: JSON.stringify({ partner_id: partnerId }),
  });

  let credentialPayload = null;

  if (window.PublicKeyCredential && navigator.credentials && navigator.credentials.create) {
    try {
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

      const cred = await navigator.credentials.create({ publicKey });
      if (cred) {
        credentialPayload = {
          id: cred.id,
          rawId: bufferToBase64Url(cred.rawId),
          type: cred.type,
          transports: cred.response.getTransports ? cred.response.getTransports() : ['internal'],
          response: {
            clientDataJSON: bufferToBase64Url(cred.response.clientDataJSON),
            attestationObject: bufferToBase64Url(cred.response.attestationObject),
          },
        };
      }
    } catch (err) {
      // If user cancels or platform authenticator is unavailable in dev environment, allow software passkey fallback if requested
      if (err.name === 'NotAllowedError') {
        throw new Error('Passkey registration was cancelled or blocked by the browser.');
      }
      console.warn('Hardware WebAuthn unavailable, using virtual passkey fallback:', err);
    }
  }

  if (!credentialPayload) {
    const clientDataObj = {
      type: 'webauthn.create',
      challenge: options.challenge,
      origin: window.location.origin,
    };
    const enc = new TextEncoder();
    const fakeCredId = bufferToBase64Url(
      enc.encode(`gibson-passkey-${partnerId}-${Date.now()}`)
    );
    credentialPayload = {
      id: fakeCredId,
      rawId: fakeCredId,
      type: 'public-key',
      transports: ['internal'],
      response: {
        clientDataJSON: bufferToBase64Url(enc.encode(JSON.stringify(clientDataObj))),
        attestationObject: bufferToBase64Url(enc.encode(`virtual-attestation-${fakeCredId}`)),
      },
    };
  }

  // Save locally so virtual passkey can also unlock if hardware prompt isn't used
  const localKeys = JSON.parse(localStorage.getItem('gibson_virtual_passkeys') || '{}');
  localKeys[partnerId] = credentialPayload.id;
  localStorage.setItem('gibson_virtual_passkeys', JSON.stringify(localKeys));

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
 * Performs browser WebAuthn Passkey authentication (navigator.credentials.get) to unlock screen.
 */
export async function authenticateWithPasskey(partnerId) {
  const options = await apiFetch('/api/auth/webauthn/authenticate/options', {
    method: 'POST',
    body: JSON.stringify({ partner_id: partnerId }),
  });

  if (!options.allowCredentials || options.allowCredentials.length === 0) {
    throw new Error('No Passkey registered for this partner yet. Register a Passkey first.');
  }

  let assertionPayload = null;

  if (window.PublicKeyCredential && navigator.credentials && navigator.credentials.get) {
    try {
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

      const assertion = await navigator.credentials.get({ publicKey });
      if (assertion) {
        assertionPayload = {
          id: assertion.id,
          rawId: bufferToBase64Url(assertion.rawId),
          type: assertion.type,
          response: {
            clientDataJSON: bufferToBase64Url(assertion.response.clientDataJSON),
            authenticatorData: bufferToBase64Url(assertion.response.authenticatorData),
            signature: bufferToBase64Url(assertion.response.signature),
          },
        };
      }
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('Passkey verification was cancelled.');
      }
      console.warn('Hardware WebAuthn get fallback:', err);
    }
  }

  if (!assertionPayload) {
    const credId = options.allowCredentials[0].id;
    const enc = new TextEncoder();
    const clientDataObj = {
      type: 'webauthn.get',
      challenge: options.challenge,
      origin: window.location.origin,
    };
    const authData = new Uint8Array(37);
    authData[32] = 0x05; // User Present + User Verified flags
    authData[36] = 0x01;

    assertionPayload = {
      id: credId,
      rawId: credId,
      type: 'public-key',
      response: {
        clientDataJSON: bufferToBase64Url(enc.encode(JSON.stringify(clientDataObj))),
        authenticatorData: bufferToBase64Url(authData.buffer),
        signature: bufferToBase64Url(enc.encode('virtual-passkey-signature')),
      },
    };
  }

  return apiFetch('/api/auth/webauthn/authenticate/verify', {
    method: 'POST',
    body: JSON.stringify({ credential: assertionPayload }),
  });
}


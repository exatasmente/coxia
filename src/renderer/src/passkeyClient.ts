// The browser side of the passkeys: WebAuthn through navigator.credentials, with the options the instance made and the result posted back.
// Only the paired browser (PWA) uses it; the instance verifies everything, this file only moves bytes.

type Rpc = (channel: string, ...args: unknown[]) => Promise<unknown>;

export const ASSERTION_HEADER = 'X-Coxia-Assertion';

export const passkeysSupported = (): boolean => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;

export const toB64 = (buf: ArrayBuffer): string => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const fromB64 = (text: string): ArrayBuffer => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

interface Descriptor {
  type: 'public-key';
  id: string;
}

/** Creates a passkey for this device: the computer must have allowed it first (the instance answers `forbidden` otherwise). */
export async function registerPasskey(rpc: Rpc, name: string): Promise<void> {
  const { challengeId, options } = (await rpc('passkey:register-options', name)) as {
    challengeId: string;
    options: { challenge: string; rp: PublicKeyCredentialRpEntity; user: { id: string; name: string; displayName: string }; excludeCredentials: Descriptor[] } & Record<string, unknown>;
  };
  const made = (await navigator.credentials.create({
    publicKey: {
      ...(options as object),
      challenge: fromB64(options.challenge),
      user: { ...options.user, id: fromB64(options.user.id) },
      excludeCredentials: options.excludeCredentials.map((c) => ({ type: c.type, id: fromB64(c.id) })),
    } as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null;
  if (!made) throw new Error('cancelled');
  const response = made.response as AuthenticatorAttestationResponse;
  await rpc('passkey:register', challengeId, { id: made.id, response: { clientDataJSON: toB64(response.clientDataJSON), attestationObject: toB64(response.attestationObject) } });
}

/** Asks the person for the passkey and returns the assertion id that lets one call of this kind through. */
export async function assertPasskey(rpc: Rpc, kind: string): Promise<string> {
  const { challengeId, options } = (await rpc('passkey:assert-options', kind)) as { challengeId: string; options: { challenge: string; allowCredentials: Descriptor[] } & Record<string, unknown> };
  const got = (await navigator.credentials.get({
    publicKey: { ...(options as object), challenge: fromB64(options.challenge), allowCredentials: options.allowCredentials.map((c) => ({ type: c.type, id: fromB64(c.id) })) } as PublicKeyCredentialRequestOptions,
  })) as PublicKeyCredential | null;
  if (!got) throw new Error('cancelled');
  const r = got.response as AuthenticatorAssertionResponse;
  const done = (await rpc('passkey:assert', challengeId, { id: got.id, response: { clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature) } })) as { assertionId: string };
  return done.assertionId;
}

import type { WebSettings } from './settings';

export interface Device {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface WebStatus {
  enabled: boolean;
  listening: boolean;
  address: string | null;
  message: string;
  clients: number;
  devices: number;
}

// What the desktop Settings screen shows ("Acesso pelo navegador").
export interface WebView {
  settings: WebSettings;
  status: WebStatus;
  devices: Device[];
  // Expiry (ms since epoch) of the pairing code in play; the code itself is shown once, when generated.
  pairingExpiresAt: number | null;
}

export interface PairingCode {
  code: string;
  expiresAt: number;
}

// What the browser asks of GET /api/session.
export interface WebSession {
  device: Device;
  allowExternalEffects: boolean;
}

// The QR code and the shared link carry the pairing code in the URL fragment, which browsers never send to a server,
// so it stays out of nginx and Cloudflare logs.
export function pairingLink(publicUrl: string, code: string): string {
  const url = new URL(publicUrl);
  url.search = '';
  url.hash = '';
  return `${url.href}#pair=${code}`;
}

export function readPairFragment(hash: string): string | null {
  return /^#pair=([A-Za-z0-9-]{8,32})$/.exec(hash)?.[1] ?? null;
}

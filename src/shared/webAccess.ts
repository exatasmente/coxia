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

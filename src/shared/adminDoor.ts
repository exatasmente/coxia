import type { AppEvent } from './types';
import type { WireError } from './contract';

// The local admin door (#211): the Unix socket a client on the same machine (the server shell, the CLI, the SDK, reached over SSH) uses to call the core's channels. Nothing in
// this file reaches the main process, so a client can import it. The framing is one JSON object per line, UTF-8, each way.

/** The socket's file name, in the running workspace's folder. */
export const ADMIN_SOCKET_NAME = 'admin.sock';

/** A line longer than this is not a message: the connection is closed. */
export const ADMIN_LINE_MAX = 8 * 1024 * 1024;

/** What may wait unsent for one client before the core closes it, so a client that stopped reading cannot grow the core's memory. */
export const ADMIN_WRITE_MAX = 8 * 1024 * 1024;

/** The first line of a client: its contract version. */
export interface AdminHelloRequest {
  hello: number;
}

/** The core's answer to a matching hello. */
export interface AdminHelloAnswer {
  hello: { version: number; workspace: string };
}

/** A refusal that closes the connection (a different contract version, a first line that is not a hello) or a line the core could not read. */
export interface AdminFailure {
  error: WireError;
}

/** A call. Several may be in flight; the answers come in any order, matched by `id`. */
export interface AdminRequest {
  id: number;
  channel: string;
  args: unknown[];
}

export type AdminAnswer = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: WireError };

/** An event the core emitted, pushed to every connected client after its hello. */
export interface AdminEvent {
  event: AppEvent;
}

/** A line the core writes. */
export type AdminLine = AdminHelloAnswer | AdminFailure | AdminAnswer | AdminEvent;

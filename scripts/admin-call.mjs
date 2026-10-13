#!/usr/bin/env node
// Calls one channel of a running core through its admin socket and prints the value as JSON (exit 0), or the error code on stderr (exit 1).
// Usage: node scripts/admin-call.mjs <socket> <channel> [json-args]    e.g.  admin-call.mjs data/workspaces/main/admin.sock web:pair
// Plain Node with no build step, so the server shell can use it; the protocol is src/shared/adminDoor.ts.
import { connect } from 'node:net';

// Kept equal to CONTRACT_VERSION in src/shared/contract.ts; test/admin-door.test.ts fails when they differ.
const CONTRACT_VERSION = 1;

const [socketPath, channel, rawArgs] = process.argv.slice(2);
if (!socketPath || !channel) {
  console.error('usage: admin-call.mjs <socket> <channel> [json-args]');
  process.exit(2);
}
let args = [];
if (rawArgs !== undefined) {
  try {
    args = JSON.parse(rawArgs);
  } catch {
    console.error('invalid-input: the arguments must be a JSON array');
    process.exit(2);
  }
  if (!Array.isArray(args)) args = [args];
}

const socket = connect(socketPath);
socket.setEncoding('utf8');
let buf = '';
const done = (code, text, stream = console.log) => {
  stream(text);
  socket.destroy();
  process.exit(code);
};
socket.on('error', (e) => done(1, `unreachable: ${e.message}`, console.error));
socket.on('close', () => done(1, 'closed: the core closed the connection', console.error));
socket.on('connect', () => socket.write(`${JSON.stringify({ hello: CONTRACT_VERSION })}\n`));
socket.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (msg.error) done(1, `${msg.error.code}: ${msg.error.message}`, console.error);
    else if (msg.hello) socket.write(`${JSON.stringify({ id: 1, channel, args })}\n`);
    else if (msg.id === 1) {
      if (msg.ok) done(0, JSON.stringify(msg.value));
      else done(1, `${msg.error.code}: ${msg.error.message}`, console.error);
    }
  }
});

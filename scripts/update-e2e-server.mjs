#!/usr/bin/env node
// A static file server for the local end-to-end test of electron-updater (scripts/update-e2e.mjs): serves a folder over HTTP on
// 127.0.0.1 with byte ranges, including the multi-range requests of a differential download, and logs every request.
//
//   node scripts/update-e2e-server.mjs --dir <folder> --port <n> --log <file.jsonl>
//
// It listens on loopback only. A real release is served over HTTPS (GitHub Releases or any static host); this is only the stand-in.
import { createReadStream, appendFileSync, statSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize, sep } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const DIR = opt('--dir');
const PORT = Number(opt('--port', '9326'));
const LOG = opt('--log');
if (!DIR) {
  console.error('usage: update-e2e-server.mjs --dir <folder> [--port 9326] [--log <file>]');
  process.exit(2);
}

const log = (entry) => {
  if (LOG) appendFileSync(LOG, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
};

// "bytes=0-99,200-299" -> [[0,99],[200,299]]; null when it is not a satisfiable byte range.
function parseRanges(header, size) {
  const m = /^bytes=(.+)$/.exec(header ?? '');
  if (!m) return null;
  const out = [];
  for (const part of m[1].split(',')) {
    const r = /^\s*(\d*)-(\d*)\s*$/.exec(part);
    if (!r || (r[1] === '' && r[2] === '')) return null;
    let start = r[1] === '' ? size - Number(r[2]) : Number(r[1]);
    let end = r[1] === '' || r[2] === '' ? size - 1 : Number(r[2]);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) return null;
    out.push([start, end]);
  }
  return out;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
  const file = join(DIR, rel);
  if (rel.split(sep).includes('..') || !file.startsWith(DIR) || !existsSync(file) || !statSync(file).isFile()) {
    log({ method: req.method, path: url.pathname, status: 404 });
    res.writeHead(404).end('not found');
    return;
  }
  const size = statSync(file).size;
  const range = req.headers.range;
  const type = file.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream';
  const ranges = range ? parseRanges(range, size) : null;
  if (range && !ranges) {
    log({ method: req.method, path: url.pathname, range, status: 416 });
    res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    return;
  }
  if (!ranges) {
    log({ method: req.method, path: url.pathname, status: 200, bytes: size });
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).pipe(res);
    return;
  }
  if (ranges.length === 1) {
    const [s, e] = ranges[0];
    log({ method: req.method, path: url.pathname, range, status: 206, bytes: e - s + 1 });
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': e - s + 1, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes' });
    createReadStream(file, { start: s, end: e }).pipe(res);
    return;
  }
  const boundary = `b${Date.now().toString(16)}`;
  const heads = ranges.map(([s, e]) => `--${boundary}\r\nContent-Type: ${type}\r\nContent-Range: bytes ${s}-${e}/${size}\r\n\r\n`);
  const tail = `\r\n--${boundary}--\r\n`;
  const total = ranges.reduce((n, [s, e], i) => n + heads[i].length + (e - s + 1) + 2, 0) - 2 + tail.length;
  log({ method: req.method, path: url.pathname, range: `${ranges.length} ranges`, status: 206, bytes: ranges.reduce((n, [s, e]) => n + (e - s + 1), 0) });
  res.writeHead(206, { 'Content-Type': `multipart/byteranges; boundary=${boundary}`, 'Content-Length': total, 'Accept-Ranges': 'bytes' });
  let i = 0;
  const next = () => {
    if (i >= ranges.length) return void res.end(tail);
    const [s, e] = ranges[i];
    res.write((i === 0 ? '' : '\r\n') + heads[i]);
    i++;
    createReadStream(file, { start: s, end: e }).on('end', next).pipe(res, { end: false });
  };
  next();
});

server.listen(PORT, '127.0.0.1', () => console.log(`serving ${DIR} on http://127.0.0.1:${PORT}/`));

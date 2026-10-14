// A stand-in for ssh, ssh-keyscan and ssh-keygen, for the tests of the remote instance (#211). No network: `ssh` listens on the local end of the forwarding and pipes each connection
// to a real Unix socket (FAKE_SSH_REAL), as the far end of an SSH tunnel would. Usage: node fake-ssh.mjs <ssh|keyscan|keygen> <the arguments of the real program>.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { connect, createServer } from 'node:net';

const [, , program, ...args] = process.argv;
const env = process.env;

if (program === 'ssh') {
  const opt = (flag) => args[args.indexOf(flag) + 1];
  const forward = args.includes('-L') ? opt('-L') : undefined;
  const keyFile = opt('-i');
  // Without -L the command is `coxia-server bridge <workspace>`: the far end's stdin and stdout are the admin socket, as the real bridge makes them.
  const bridge = forward === undefined;
  const local = bridge ? '' : forward.slice(0, forward.indexOf(':'));
  const remote = bridge ? '' : forward.slice(forward.indexOf(':') + 1);
  appendFileSync(env.FAKE_SSH_LOG, `${JSON.stringify({ pid: process.pid, args, local, remote, keyMode: (statSync(keyFile).mode & 0o777).toString(8), keyHad: readFileSync(keyFile, 'utf8').slice(0, 11) })}\n`);
  if (env.FAKE_SSH_FAIL) {
    process.stderr.write('Permission denied (publickey).\n');
    process.exit(255);
  }
  if (bridge) {
    const far = connect(env.FAKE_SSH_REAL);
    far.on('error', () => process.exit(255));
    far.on('close', () => process.exit(0));
    process.stdin.pipe(far);
    far.pipe(process.stdout);
    process.stdin.on('end', () => far.end());
    process.on('SIGTERM', () => process.exit(0));
  } else {
  createServer((client) => {
    if (remote !== env.FAKE_SSH_REMOTE) return void client.destroy();
    const far = connect(env.FAKE_SSH_REAL);
    far.on('error', () => client.destroy());
    client.on('error', () => far.destroy());
    client.pipe(far);
    far.pipe(client);
  }).listen(local);
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => undefined, 1000);
  }
} else if (program === 'keyscan') {
  const port = args[args.indexOf('-p') + 1];
  const host = args[args.length - 1];
  process.stdout.write(`${port === '22' ? host : `[${host}]:${port}`} ssh-ed25519 ${env.FAKE_HOST_KEY}\n`);
} else if (program === 'keygen') {
  if (args[0] === '-F') {
    const file = args[args.indexOf('-f') + 1];
    const found = existsSync(file) && readFileSync(file, 'utf8').split('\n').some((l) => l.split(' ')[0] === args[1]);
    process.exit(found ? 0 : 1);
  }
  const line = readFileSync(0, 'utf8').trim().split(' ');
  process.stdout.write(`256 SHA256:${createHash('sha256').update(Buffer.from(line[2], 'base64')).digest('base64').replace(/=+$/, '')} ${line[0]} (ED25519)\n`);
}

import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/shared/procedures';
import { buildCommandDraft, programOf, type ExecEntry } from '../src/main/procedures/commands';

const HOME = '/home/someone';
let n = 0;
const ok = (command: string): ExecEntry => ({ n: ++n, command, exitCode: 0, timedOut: false });
const bad = (command: string, exitCode = 1): ExecEntry => ({ n: ++n, command, exitCode, timedOut: false });
const slow = (command: string): ExecEntry => ({ n: ++n, command, exitCode: null, timedOut: true });
const draft = (entries: ExecEntry[], over: Partial<Parameters<typeof buildCommandDraft>[1]> = {}) => buildCommandDraft(entries, { home: HOME, ...over });
const runs = (entries: ExecEntry[], over?: Partial<Parameters<typeof buildCommandDraft>[1]>): string[] => draft(entries, over).steps.map((s) => s.run);

describe('the path that worked (acceptance 1)', () => {
  it('drops noise, refused and never-run commands without counting them', () => {
    n = 0;
    const d = draft([
      ok('ls -la'),
      ok('cat package.json'),
      ok('git status'),
      ok('git log --oneline'),
      ok('pwd'),
      ok('grep -rn TODO src'),
      { n: ++n, command: 'rm -rf build', exitCode: null, timedOut: false, refused: 'denied' },
      { n: ++n, command: 'npm ci', exitCode: null, timedOut: false },
      ok('npm test'),
    ]);
    expect(d.steps).toEqual([{ n: 1, text: 'Run npm test', run: 'npm test' }]);
    expect(d.leftOut).toBe(0);
    expect(d.pitfalls).toEqual([]);
  });

  it('reads the noise from the first program of the first segment, through the wrappers', () => {
    n = 0;
    expect(runs([ok('sudo ls /var'), ok('time cat a.txt && npm test'), ok('git diff HEAD'), ok('git commit -m work')])).toEqual(['git commit -m work']);
  });

  it('keeps one step and one pitfall for a failure followed by a success of the same program', () => {
    n = 0;
    const d = draft([bad('npm test'), ok('npm test -- --runInBand')]);
    expect(d.steps).toEqual([{ n: 1, text: 'Run npm test', run: 'npm test -- --runInBand' }]);
    expect(d.pitfalls).toEqual(['Failed (exit 1): npm test']);
    expect(d.failed).toEqual(['Run npm test']);
    expect(d.trial).toBe(true);
  });

  it('keeps a failure with no later success only as a pitfall, and it is not trial and error', () => {
    n = 0;
    const d = draft([ok('npm ci'), bad('pytest -x', 2)]);
    expect(d.steps.map((s) => s.run)).toEqual(['npm ci']);
    expect(d.pitfalls).toEqual(['Failed (exit 2): pytest -x']);
    expect(d.trial).toBe(false);
  });

  it('does not count a later success of another program as the failure being worked out', () => {
    n = 0;
    expect(draft([bad('pytest'), ok('npm test')]).trial).toBe(false);
  });

  it('does not count a success that came before the failure', () => {
    n = 0;
    const d = draft([ok('npm test'), bad('npm test -- --bail')]);
    expect(d.trial).toBe(false);
    expect(d.steps.map((s) => s.run)).toEqual(['npm test']);
  });

  it('words a timeout as a pitfall', () => {
    n = 0;
    const d = draft([slow('npm run e2e'), ok('npm run e2e -- --headless')]);
    expect(d.pitfalls).toEqual(['Timed out: npm run e2e']);
    expect(d.steps.map((s) => s.run)).toEqual(['npm run e2e -- --headless']);
    expect(d.trial).toBe(true);
  });

  it('keeps a success repeated word for word at its last position', () => {
    n = 0;
    expect(runs([ok('npm ci'), ok('npm run build'), ok('npm ci'), ok('npm test')])).toEqual(['npm run build', 'npm ci', 'npm test']);
  });

  it('numbers the steps in the order they ran, whatever the order of the log', () => {
    n = 0;
    const entries = [ok('npm ci'), ok('npm run build'), ok('npm test')].reverse();
    expect(draft(entries).steps.map((s) => [s.n, s.run])).toEqual([[1, 'npm ci'], [2, 'npm run build'], [3, 'npm test']]);
  });

  it('words a step as the program and a plain subcommand, and the run as the command with its white space collapsed', () => {
    n = 0;
    const d = draft([ok('npm   run   build'), ok('./scripts/deploy.sh --dry'), ok('node -e 1'), ok('pytest -k "a b"')]);
    expect(d.steps.map((s) => s.text)).toEqual(['Run npm run', 'Run deploy.sh', 'Run node', 'Run pytest']);
    expect(d.steps[0].run).toBe('npm run build');
  });

  it('lists the programs with most steps first, the first to appear on a tie', () => {
    n = 0;
    expect(draft([ok('make build'), ok('npm ci'), ok('npm test'), ok('docker ps')]).programs).toEqual(['npm', 'make', 'docker']);
    n = 0;
    expect(draft([ok('make build'), ok('npm ci')]).programs).toEqual(['make', 'npm']);
  });

  it('is not trial and error when nothing was kept', () => {
    n = 0;
    const d = draft([bad('npm test')]);
    expect(d.steps).toEqual([]);
    expect(d.trial).toBe(false);
    expect(draft([]).steps).toEqual([]);
  });

  it('reads the program through a path and the wrappers', () => {
    expect(programOf('./node_modules/.bin/jest --ci')).toBe('jest');
    expect(programOf('sudo env A=1 NODE_ENV=test npm test')).toBe('npm');
    expect(programOf('npm test && npm run build')).toBe('npm');
  });
});

describe('the environment and the folder a command starts from', () => {
  it('strips environment assignments, env and a leading cd from a kept command', () => {
    n = 0;
    expect(runs([ok('NODE_ENV=test CI=1 npm test'), ok('env FOO=bar npm run build'), ok('cd packages/api && npx jest'), ok('cd /tmp/work && FOO="a b" make')])).toEqual(['npm test', 'npm run build', 'npx jest', 'make']);
  });

  it('leaves out a command that is only an assignment or whose assignment holds a substitution', () => {
    n = 0;
    const d = draft([ok('FOO=bar'), ok('FOO=$(cat other) npm test'), ok('FOO=`pwd` npm test'), ok('FOO=1; npm test')]);
    expect(d.steps).toEqual([]);
    expect(d.leftOut).toBe(4);
  });

  // A value of the environment can sit anywhere, not only before the program: none of these may reach a step, a pitfall or a count of anything but `leftOut`.
  const hidden = [
    'npm ci && PGPASS=hunter2 node migrate.js',
    'npm run build; DBPW=hunter2 npm run b',
    'time DBPW=hunter2 npm run d',
    'nohup DBPW=hunter2 npm run x',
    'sudo FOO=abc123xyz789 npm run build',
    'docker run -e DB_PW=hunter2 img',
    'docker run --env DB_PW=hunter2 img',
    'docker run --env-file prod.list img',
    "bash -c 'DBPW=hunter2 npm run i'",
    'sh -c "npm run j --pw hunter2"',
    'eval "$(tool)"',
    'mycli --user bob --pw hunter2',
    'mycli --pwd hunter2',
    'mycli --pass hunter2',
    'mycli --passphrase hunter2',
    'mycli --key hunter2',
    'mycli --key=hunter2',
    'mycli --auth hunter2',
    'mycli --credentials hunter2',
    'mycli --dsn hunter2',
    'mycli postgres:hunter2@db.example.com',
    'sudo -p hunter2 npm test',
  ];

  it.each(hidden)('leaves out and counts %j', (command) => {
    n = 0;
    const d = draft([ok(command), ok('npm test')]);
    expect(d.steps.map((s) => s.run)).toEqual(['npm test']);
    expect(d.leftOut).toBe(1);
    expect(JSON.stringify(d)).not.toContain('hunter2');
  });

  it.each(['npm run build', 'npm test -- --run', 'git push --force-with-lease', 'node scripts/x.mjs --out=dist', 'sudo -u deploy npm ci', 'env -i npm test', 'time npm run build'])('still drafts %j', (command) => {
    n = 0;
    const d = draft([ok(command)]);
    expect(d.steps).toHaveLength(1);
    expect(d.leftOut).toBe(0);
  });

  it('strips the options of env with the assignments after them, and the value goes with them', () => {
    n = 0;
    const d = draft([ok('env -i DBPW=hunter2 npm test'), ok('env -u HOME -- DBPW=hunter2 npm run build')]);
    expect(d.steps.map((s) => s.run)).toEqual(['npm test', 'npm run build']);
    expect(JSON.stringify(d)).not.toContain('hunter2');
  });

  it('reads the program only after the wrappers and their options', () => {
    expect(programOf('env -i -u HOME npm test')).toBe('npm');
    expect(programOf('sudo -u bob -E npm test')).toBe('npm');
    expect(programOf('time -p npm test')).toBe('npm');
  });
});

describe('what a command may carry (acceptance 2)', () => {
  const carriers = [
    'export TOKEN=abc',
    'set -a',
    'unset FOO',
    'source ./env.sh',
    '. ./env.sh',
    "curl -H 'Authorization: Bearer abc' https://example.com/api",
    'curl -u me:pw https://example.com',
    'curl -d @body.json https://example.com',
    'curl --data-binary @x https://example.com',
    'curl -sSu admin https://example.com',
    'wget --header "X-Key: abc" https://example.com/f',
    'http POST https://example.com/api -F file@x',
    'cat .env',
    'npm config set //registry.example.com/:_authToken abc',
    'cp ~/.npmrc /tmp',
    'ssh -i ~/.ssh/id_rsa host.example.com',
    'openssl x509 -in cert.pem',
    'git clone https://user:pass@example.com/group/project.git',
    'mysql -p secret -e "select 1"',
    'psql --password hunter2',
    'cat <<EOF > file',
    'cat <<< word',
    'echo $API_KEY',
    'npm run test:token',
    'deploy --cookie jar',
    'tool --secret-file x',
    'ls ~/.aws',
    'node app.js abcdef0123456789abcdef0123',
    'send-mail someone@example.com',
    'report --id 123456',
    `cp ${HOME}/notes.txt out`,
    'npm test\nrm -rf x',
  ];

  it.each(carriers)('leaves out and counts %j', (command) => {
    n = 0;
    const d = draft([ok(command), ok('npm test')]);
    expect(d.steps.map((s) => s.run)).toEqual(['npm test']);
    expect(d.leftOut).toBe(1);
  });

  it('leaves out a failed command that carries one too: it is neither a step nor a pitfall', () => {
    n = 0;
    const d = draft([bad('curl -H "Authorization: x" https://example.com'), ok('npm test')]);
    expect(d.pitfalls).toEqual([]);
    expect(d.leftOut).toBe(1);
  });

  it('leaves out a command over the run cap, and does not cut it', () => {
    n = 0;
    const long = `npm run build -- ${'a'.repeat(LIMITS.stepRun)}`;
    const d = draft([ok(long), ok('npm test')]);
    expect(d.steps.map((s) => s.run)).toEqual(['npm test']);
    expect(d.leftOut).toBe(1);
    expect(JSON.stringify(d)).not.toContain('aaaa');
    n = 0;
    const exact = `npm run ${'a'.repeat(LIMITS.stepRun - 'npm run '.length)}`;
    expect(exact).toHaveLength(LIMITS.stepRun);
    expect(runs([ok(exact)])).toEqual([exact]);
  });

  it('leaves out a command the test environment mask would change, read before anything is stripped', () => {
    n = 0;
    const mask = (s: string): string => s.replaceAll('hunter22value', '***');
    const d = draft([ok('npm test --grep hunter22value'), ok('SECRET_X=hunter22value npm run build'), ok('npm test')], { mask });
    expect(d.steps.map((s) => s.run)).toEqual(['npm test']);
    expect(d.leftOut).toBe(2);
  });

  it('leaves out a command that holds something the person typed', () => {
    n = 0;
    const typedIn = (s: string): boolean => s.includes('maple-4-sunset');
    const d = draft([ok('npm run login maple-4-sunset'), ok('npm test')], { typedIn });
    expect(d.steps.map((s) => s.run)).toEqual(['npm test']);
    expect(d.leftOut).toBe(1);
  });

  it('leaves out a step the validator would refuse and counts it', () => {
    n = 0;
    const d = draft([ok('mkdir -p out'), ok('tool --retries 3'), ok('tool --port=8080 --name=a-1234567890-b1234567890')]);
    expect(d.steps.map((s) => s.run)).toEqual(['mkdir -p out', 'tool --retries 3']);
    expect(d.leftOut).toBe(1);
  });

  it('holds neither the text nor the words of a left-out command anywhere in the draft', () => {
    n = 0;
    const d = draft([
      bad('curl -H "Authorization: Bearer zq81xk" https://example.com'),
      ok('export TOKEN=zq81xk'),
      ok('cat .env.zq81xk'),
      ok('npm test'),
    ]);
    expect(d.leftOut).toBe(3);
    expect(JSON.stringify(d)).not.toContain('zq81xk');
  });

  it('still keeps an ordinary command with a pinned version, a date or a port', () => {
    n = 0;
    expect(runs([ok('npm install left-pad@1.3.0'), ok('docker run -p 8080:80 nginx'), ok('git log --since 2026-10-01')])).toEqual(['npm install left-pad@1.3.0', 'docker run -p 8080:80 nginx']);
  });

  it('caps the pitfalls at what a record keeps', () => {
    n = 0;
    const entries = Array.from({ length: 12 }, (_, i) => bad(`pytest tests/t${i}.py`));
    expect(draft(entries).pitfalls).toHaveLength(LIMITS.pitfalls);
  });

  it('copies no field of an entry but the four it needs', () => {
    n = 0;
    const e = { ...ok('npm test'), output: 'sk-should-not-appear', extra: 'zz-unseen' } as ExecEntry;
    expect(JSON.stringify(draft([e]))).not.toMatch(/should-not-appear|zz-unseen/);
  });
});

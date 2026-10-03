// The PATH of the person's login shell, read once and put in front of the app's: with a fake shell, never a real one.
import { describe, expect, it } from 'vitest';
import { createLoginPath, loginEnv, loginEnvNow, mergedPath, pathFromOutput } from '../src/main/loginPath';

const out = (path: string) => `Last login: today\n__coxia_path_start__${path}__coxia_path_end__\n`;

describe('reading the login PATH', () => {
  it('takes what is between the markers, whatever a shell prints around it', () => {
    expect(pathFromOutput(out('/a/bin:/usr/bin'))).toBe('/a/bin:/usr/bin');
    expect(pathFromOutput('no markers here')).toBeNull();
    expect(pathFromOutput('__coxia_path_start____coxia_path_end__')).toBeNull();
    expect(pathFromOutput('__coxia_path_start__a\nb__coxia_path_end__')).toBeNull();
    // a startup file that echoes the markers itself does not win over the real answer
    expect(pathFromOutput(`__coxia_path_start__fake__coxia_path_start__/real/bin__coxia_path_end__`)).toBe('/real/bin');
  });

  it('starts the shell once, as a login shell that reads its startup files, and keeps the answer', async () => {
    const calls: { shell: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const source = createLoginPath({
      env: { SHELL: '/bin/zsh', HOME: '/home/ana' },
      run: async (shell, args, o) => {
        calls.push({ shell, args, env: o.env });
        return out('/home/ana/.nvm/versions/node/v20/bin:/usr/bin');
      },
    });
    expect(source.peek()).toBeNull();
    const [a, b] = await Promise.all([source.resolve(), source.resolve()]);
    expect(a).toBe('/home/ana/.nvm/versions/node/v20/bin:/usr/bin');
    expect(b).toBe(a);
    await source.resolve();
    expect(calls).toHaveLength(1);
    expect(calls[0].shell).toBe('/bin/zsh');
    expect(calls[0].args[0]).toBe('-ilc');
    expect(source.peek()).toBe(a);
  });

  it('says nothing when it cannot read it: no shell, a failure, a timeout, Windows, or the switch that turns it off', async () => {
    const failing = createLoginPath({ env: { SHELL: '/bin/zsh' }, run: async () => Promise.reject(new Error('timed out')) });
    expect(await failing.resolve()).toBeNull();
    const silent = createLoginPath({ env: { SHELL: '/bin/zsh' }, run: async () => 'no markers' });
    expect(await silent.resolve()).toBeNull();
    let started = false;
    const run = async () => ((started = true), out('/x'));
    expect(await createLoginPath({ env: { SHELL: '/bin/zsh' }, platform: 'win32', run }).resolve()).toBeNull();
    expect(await createLoginPath({ env: { SHELL: '/bin/zsh', COXIA_NO_LOGIN_SHELL: '1' }, run }).resolve()).toBeNull();
    expect(started).toBe(false);
    // with no SHELL at all the system's own is used
    const shells: string[] = [];
    await createLoginPath({ env: {}, run: async (s) => (shells.push(s), out('/x')) }).resolve();
    expect(shells).toEqual(['/bin/sh']);
  });
});

describe('putting it in front of the app\'s PATH', () => {
  it('puts the login folders first, keeps the app\'s own after them without repeats, and leaves out the app\'s own mount', () => {
    const env = { PATH: '/tmp/.mount_app/usr/bin:/usr/bin:/home/ana/.local/bin', APPDIR: '/tmp/.mount_app' };
    expect(mergedPath('/home/ana/.nvm/bin:/usr/bin', env)).toBe('/home/ana/.nvm/bin:/usr/bin:/home/ana/.local/bin');
    expect(mergedPath(null, env)).toBe(env.PATH);
    expect(mergedPath('/a', {})).toBe('/a');
  });

  it('changes only the PATH of the environment it is given, with the login shell\'s answer or without it', async () => {
    const source = createLoginPath({ env: { SHELL: '/bin/zsh' }, run: async () => out('/home/ana/.nvm/bin') });
    const base = { PATH: '/usr/bin', HOME: '/home/ana', EDITOR: 'vi' } as NodeJS.ProcessEnv;
    expect(loginEnvNow(base, source)).toEqual(base);
    expect(await loginEnv(base, source)).toEqual({ ...base, PATH: '/home/ana/.nvm/bin:/usr/bin' });
    expect(loginEnvNow(base, source)).toEqual({ ...base, PATH: '/home/ana/.nvm/bin:/usr/bin' });
    expect(base.PATH).toBe('/usr/bin');
    const none = createLoginPath({ env: { SHELL: '/bin/zsh' }, run: async () => Promise.reject(new Error('x')) });
    expect(await loginEnv(base, none)).toEqual(base);
  });
});

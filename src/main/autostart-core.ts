import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function autostartFile(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'autostart/cerimonias.desktop');
}

// Desktop Entry spec: an argument with reserved characters is double-quoted, `"`, `` ` ``, `$` and `\`
// get a backslash inside the quotes, and every backslash is doubled again by the string layer.
function execArg(arg: string): string {
  const safe = arg.replace(/%/g, '%%');
  if (!/[\s"'\\<>~|&;$*?#()`]/.test(safe)) return safe;
  return `"${safe.replace(/(["`$\\])/g, '\\$1').replace(/\\/g, '\\\\')}"`;
}

export function desktopEntry(command: string[]): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Cerimônias',
    'Comment=Cerimônias por voz, começa só na bandeja',
    `Exec=${command.map(execArg).join(' ')}`,
    'Icon=cerimonias',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

// What the login entry runs. Packaged: the AppImage that is running (APPIMAGE) or the installed binary,
// never the dev tree. Dev: electron on the repository.
export function launchCommandFor(opts: { packaged: boolean; execPath: string; appPath: string; appImage?: string }): string[] {
  if (!opts.packaged) return [opts.execPath, opts.appPath, '--hidden'];
  return [opts.appImage || opts.execPath, '--hidden'];
}

export function isAutostart(): boolean {
  return existsSync(autostartFile());
}

export function setAutostart(on: boolean, command: string[]): boolean {
  const file = autostartFile();
  if (on) {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, desktopEntry(command));
  } else {
    rmSync(file, { force: true });
  }
  return isAutostart();
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');

// The public identity is Coxia; what an install made by an earlier version keeps its data, lock and launcher under is not allowed to move.
describe('public identity and runtime identity', () => {
  const builder = read('electron-builder.yml');
  const pkg = JSON.parse(read('package.json'));

  it('names the product Coxia and the release files coxia-*', () => {
    expect(builder).toMatch(/^productName: Coxia$/m);
    expect(builder).toMatch(/^appId: io\.github\.exatasmente\.coxia$/m);
    expect(builder).toMatch(/artifactName: coxia-\$\{version\}\.\$\{ext\}/);
    expect(builder).toMatch(/artifactName: coxia_\$\{version\}_amd64\.\$\{ext\}/);
    expect(builder).toMatch(/packageName: coxia$/m);
  });

  it('keeps the executable, the desktop name and the package name of the earlier versions', () => {
    expect(builder).toMatch(/^executableName: cerimonias$/m);
    expect(pkg.name).toBe('cerimonias');
    expect(pkg.desktopName).toBe('cerimonias.desktop');
  });

  it('pins the runtime app name and userData to the original ones, unless a scratch run chooses its own', () => {
    const main = read('src/main/index.ts');
    expect(main).toMatch(/app\.setName\('cerimonias'\)/);
    expect(main).toMatch(/!process\.env\.CERIMONIAS_DATA_DIR && !app\.commandLine\.hasSwitch\('user-data-dir'\)\) app\.setPath\('userData', join\(app\.getPath\('appData'\), 'cerimonias'\)\)/);
  });

  it('carries the project metadata of the public repository', () => {
    expect(pkg.license).toBe('Apache-2.0');
    expect(pkg.author).toEqual({ name: 'Luiz Neto', email: '22161417+exatasmente@users.noreply.github.com' });
    expect(pkg.homepage).toBe('https://github.com/exatasmente/coxia');
    expect(pkg.repository.url).toBe('git+https://github.com/exatasmente/coxia.git');
    expect(pkg.bugs.url).toBe('https://github.com/exatasmente/coxia/issues');
    expect(pkg.private).toBe(true);
    expect(builder).toMatch(/maintainer: Luiz Neto <22161417\+exatasmente@users\.noreply\.github\.com>/);
  });
});

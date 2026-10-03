import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyTree, treeSize } from '../src/main/sandbox/copy';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-copy-'));
  mkdirSync(join(root, 'from/src'), { recursive: true });
  mkdirSync(join(root, 'from/.git'));
  writeFileSync(join(root, 'from/.git/config'), 'secret');
  writeFileSync(join(root, 'from/src/a.ts'), 'export const a = 1;\n');
  symlinkSync('/etc/hostname', join(root, 'from/outside'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the copy of a tree', () => {
  it('copies files and folders, keeps a link as a link, and leaves .git out', () => {
    copyTree(join(root, 'from'), join(root, 'to'), 1e6);
    expect(readFileSync(join(root, 'to/src/a.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(lstatSync(join(root, 'to/outside')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(root, 'to/outside'))).toBe('/etc/hostname');
    expect(existsSync(join(root, 'to/.git'))).toBe(false);
  });

  it('measures files only, without following a link', () => {
    expect(treeSize(join(root, 'from'))).toBe('export const a = 1;\n'.length);
  });

  it('refuses a tree over the limit before copying anything', () => {
    expect(() => copyTree(join(root, 'from'), join(root, 'to'), 5)).toThrow(/too large|grande demais/);
    expect(existsSync(join(root, 'to'))).toBe(false);
  });
});

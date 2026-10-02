import { readFileSync } from 'node:fs';
import { BrowserWindow, dialog } from 'electron';
import type { ApplyOptions } from '../shared/cycles';
import { t } from '../shared/i18n';
import { CYCLE_EVENT } from '../shared/cycles/events';
import { applyCycleTemplate, checkTemplateText, cycleView, exportCurrentCycle, listTemplates, removeTemplate, saveTemplateText } from './cycle-core';
import type { Module } from './module';

// The channels of the development cycle: read the view the screens follow, list and apply templates, and move templates in and out as files.
// Everything that writes the config or touches a file is desktop-only (webPolicy.ts).

const parentWindow = (): BrowserWindow | undefined => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

export const cycleModule: Module = (ctx) => {
  const announce = () => {
    const view = cycleView();
    ctx.emit({ type: 'module', name: CYCLE_EVENT, payload: view });
    return view;
  };

  ctx.handle('cycle:view', () => cycleView());
  ctx.handle('cycle:templates', () => listTemplates());
  ctx.handle('cycle:apply', (id: string, options?: ApplyOptions) => {
    applyCycleTemplate(id, options);
    return announce();
  });
  ctx.handle('cycle:template-export', (meta: { id: string; name: string; description?: string }) => exportCurrentCycle(meta));
  ctx.handle('cycle:template-check', (text: string) => checkTemplateText(text));
  ctx.handle('cycle:template-save', (text: string) => saveTemplateText(text));
  ctx.handle('cycle:template-remove', (id: string) => {
    removeTemplate(id);
    return listTemplates();
  });
  // Opens a file picker and returns the text of the chosen template file (null when cancelled); the check and the save are separate calls.
  ctx.handle('cycle:template-pick', async (): Promise<string | null> => {
    const options = { title: t('cycle.import.title'), properties: ['openFile' as const], filters: [{ name: t('cycle.import.filter'), extensions: ['json'] }] };
    const win = parentWindow();
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return picked.canceled || !picked.filePaths[0] ? null : readFileSync(picked.filePaths[0], 'utf8');
  });
};

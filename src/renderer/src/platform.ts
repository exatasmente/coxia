// True in the browser build (PWA); the Electron window has window.api from the preload.
export const isWeb = (): boolean => document.documentElement.dataset.platform === 'web';

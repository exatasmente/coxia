import { createTranslator } from '../../../shared/i18n';

// User-facing texts of the open engine. The wording lives in the main catalogs (src/shared/i18n/main.*.json, keys "main.engine.<key>");
// each call names the language, because a probe may run for a language other than the one the app shows.
export type Lang = 'pt-BR' | 'en';
export type Params = Record<string, string | number>;

export const MSG_KEYS = [
  'connRefused',
  'hostNotFound',
  'timeout',
  'connReset',
  'upstreamUnreachable',
  'auth',
  'forbidden',
  'budget',
  'modelNotFound',
  'rateLimit',
  'quota',
  'contextTooLong',
  'noTools',
  'badRequest',
  'serverError',
  'overloaded',
  'contentFilter',
  'streamBroken',
  'invalidUpstream',
  'probeUnreachable',
  'probeModelsOk',
  'probeModelsFail',
  'probeModelMissing',
  'probePlainOk',
  'probePlainFail',
  'probeToolsOk',
  'probeToolsNoCall',
  'probeToolsFail',
  'probeToolsBadArgs',
  'probeSlow',
  'probeReasoning',
  'probeContext',
  'probeSmallContext',
] as const;

export type MsgKey = (typeof MSG_KEYS)[number];

export function msg(lang: Lang, key: MsgKey, params: Params = {}): string {
  const tr = createTranslator(lang);
  const filled: Params = { ...params };
  // The optional hint goes in as a ready-made fragment: "(name)" for a model not found, "(e.g. name)" for one missing from the list.
  if (key === 'modelNotFound') filled.hintPart = params.hint ? tr('main.engine.hintPlain', { hint: params.hint }) : '';
  if (key === 'probeModelMissing') filled.hintPart = params.hint ? tr('main.engine.hintExample', { hint: params.hint }) : '';
  return tr(`main.engine.${key}`, filled);
}

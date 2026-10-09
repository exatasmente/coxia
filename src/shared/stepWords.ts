import type { StepWords } from './browser';
import { type Translate, t as translate } from './i18n';

// A held step in words, for the card, a notification, a thread line and the audit log. It reads the step as the app described it from the page (the control's role and name), never a
// value an agent typed. The renderer passes its own translator so the card follows the language at once.

/** The words of a step, in the app's language, for a notification, a thread line or the audit log. */
export function describeStep(step: StepWords, site = '', t: Translate = translate): string {
  const target = step.name ? t('main.browser.step.target', { role: step.role ?? '', name: step.name }) : step.role ? t('main.browser.step.targetNoName', { role: step.role }) : t('main.browser.step.targetUnknown');
  const inTarget = step.name || step.role;
  let text: string;
  switch (step.action) {
    case 'click':
      text = t('main.browser.step.click', { target });
      break;
    case 'type':
      text = t('main.browser.step.type', { target });
      break;
    case 'press':
      text = step.key ? (inTarget ? t('main.browser.step.pressIn', { key: step.key, target }) : t('main.browser.step.press', { key: step.key })) : inTarget ? t('main.browser.step.pressAnyIn', { target }) : t('main.browser.step.pressAny');
      break;
    case 'select':
      text = t('main.browser.step.select', { target });
      break;
    case 'hover':
      text = t('main.browser.step.hover', { target });
      break;
    default:
      text = t(`main.browser.step.${step.action}`);
  }
  if (step.submit) text += t('main.browser.step.submit');
  else if (step.word) text += t('main.browser.step.word', { word: step.word });
  if (site) text += t('main.browser.step.on', { site });
  return text;
}

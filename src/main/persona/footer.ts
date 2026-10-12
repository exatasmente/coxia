import { CATALOGS, t } from '../../shared/i18n';

// The text the persona composes for the code host goes out under the person's own token, so the host shows the person as its author. A fixed one-line footer, worded by the app and
// never by the model, says who wrote it. It is added by the door to the fields an operation marks as host text, once, and never to what stays inside the app. (#248)

export const FOOTER_KEY = 'main.persona.footer';

/** The footer in every language the app has, to tell a text that already ends with one. */
const footers = (): string[] => Object.values(CATALOGS).map((c) => c[FOOTER_KEY]).filter((v): v is string => typeof v === 'string' && v.length > 0);

/** The text with the footer at its end: a blank line, then the sentence in the workspace's language. A text that already ends with a footer is returned as it is. */
export function signHostText(text: string): string {
  const body = text.trimEnd();
  if (footers().some((f) => body.endsWith(f))) return body;
  return body ? `${body}\n\n${t(FOOTER_KEY)}` : t(FOOTER_KEY);
}

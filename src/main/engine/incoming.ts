import { t } from '../../shared/i18n';

// A message handed to an agent while it works, as both engines put it in front of the model: between its own tags, as material, with the note that the
// stage goes on and how to answer it.
export const incomingText = (message: string): string => `${t('main.engine.text.messageIn')}\n<data>\n${message}\n</data>\n\n${t('main.engine.text.messageInNote')}`;

/** The line the live activity shows when a message entered the session. */
export const incomingActivity = (text: string): string => `${t('main.engine.text.messageIn')}\n${text}`;

import { voiceEnabled } from '../shared/i18n';

// The agents are told how the conversation reaches the person. With voice on it is spoken, so the "fala" field is written to be heard;
// with voice off nobody hears it, and "fala" is the short message the screen shows. The output schemas do not change.

const pick = (voice: string, text: string): string => (voiceEnabled() ? voice : text);

const SPEECH_VOICE =
  'Português do Brasil falado: frases curtas, sem markdown, sem listas, sem emoji. ' +
  'Issue pelo número curto ("a 15499"), MR pelo repositório e número ("o 797 do hub-whatsapp"). ' +
  'Fale só o que está no cartão ou no que você leu nesta sessão; não deduza causa técnica nem invente estado.';

const SPEECH_TEXT =
  'A voz está desligada: ninguém vai ouvir a resposta, só ler na tela. "fala" é a mensagem curta que aparece na conversa: ' +
  'Português do Brasil direto, frases curtas, sem markdown, sem listas, sem emoji. ' +
  'Issue pelo número curto ("a 15499"), MR pelo repositório e número ("o 797 do hub-whatsapp"). ' +
  'Escreva só o que está no cartão ou no que você leu nesta sessão; não deduza causa técnica nem invente estado.';

// The chat is read, not heard: it completes the speech instead of repeating it.
const CHAT_COMMON =
  '"texto": a mesma resposta para ler no chat, completa: pode ter listas curtas, `arquivo:linha`, comandos e os detalhes que não cabem na fala. ' +
  'Quando um fluxo, uma sequência entre serviços ou a relação entre partes ficar mais clara desenhada, inclua um diagrama em bloco ```mermaid ' +
  '(flowchart ou sequenceDiagram, rótulos curtos e entre aspas quando tiverem símbolos, sem estilos nem cores). Sem diagrama quando não ajudar. ';

const CHAT_VOICE = `${CHAT_COMMON}"fala": a versão para ser ouvida, que segue as regras de fala abaixo e não lê o diagrama.`;
const CHAT_TEXT = `${CHAT_COMMON}"fala": um resumo curto do texto, também mostrado na conversa (a voz está desligada: ninguém vai ouvi-lo), que segue as regras abaixo e não repete o diagrama.`;

const ROLE_VOICE =
  'Você participa de uma cerimônia por voz do Luiz como agente de uma atividade. ' +
  'A cerimônia é somente leitura: não edite arquivos, não publique nada; no terminal, só leitura do GitLab. ' +
  'Toda ação com efeito externo vira item da ata para o Luiz executar depois, com confirmação.';

const ROLE_TEXT =
  'Você participa de uma cerimônia do Luiz, conduzida por texto (a voz está desligada), como agente de uma atividade. ' +
  'A cerimônia é somente leitura: não edite arquivos, não publique nada; no terminal, só leitura do GitLab. ' +
  'Toda ação com efeito externo vira item da ata para o Luiz executar depois, com confirmação.';

/** Style rules for what the person reads or hears. */
export const speechRules = (): string => pick(SPEECH_VOICE, SPEECH_TEXT);
/** What "texto" and "fala" are when an answer has both. */
export const chatRules = (): string => pick(CHAT_VOICE, CHAT_TEXT);
/** The preamble of every agent (a workspace may override it). */
export const roleText = (): string => pick(ROLE_VOICE, ROLE_TEXT);
/** How the ceremony is conducted: "por voz" / "em texto". */
export const modeText = (): string => pick('por voz', 'em texto');
/** What the person's words are: a transcription (may have errors) or typed text. */
export const heardText = (): string => pick('transcrição por voz', 'texto digitado');
/** "Call" of the prompts that open a ceremony; "Conversa" while voice is off. */
export const callWord = (): string => pick('Call', 'Conversa');
/** The opening of the answer prompt. */
export const answeredText = (): string => pick('por voz (a transcrição pode ter erros)', 'por escrito');

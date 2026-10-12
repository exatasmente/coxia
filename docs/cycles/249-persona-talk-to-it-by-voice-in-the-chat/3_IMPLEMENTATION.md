# Implementação: voz no chat da persona e modo de voz

Esta etapa rodou em três tentativas. A primeira deixou o código das cinco entregas e quatro testes (o app reiniciou no meio dela). A segunda completou os testes e a documentação e corrigiu o que os gates mostraram. A terceira voltou da integração só por causa da base. O app faz um commit só por etapa, não um por entrega como o plano previa.

## O que foi feito, por entrega do plano

### 1. Áudio compartilhado
- `src/renderer/src/voice/`: `playback.ts`, `recorder.ts`, `talk.ts`, `state.ts`; `audio.ts` só reexporta. Nenhuma tela de cerimônia mudou de import.
- Callback de silêncio do `useRecorder` recebe `{ reason: 'silence' | 'limit' | 'barge', heard }`.
- `micSupport.ts`: `micSupport`, `micEnvironment`, `explainMicError`.
- Testes: `voice-vad-discard`, `voice-mic-support`.

### 2. Origem "voz" e prompt
- `ForumMessage.origin?: 'voice'` e `messageOrigin()` em `src/shared/forum.ts`; `forum:post(thread, text, origin?)` em `forum.ts`/`forum-core.ts`; `forumApi.post(..., origin?)`.
- `MentionInput.persona.voice` em `call.ts`, ligado por `answer.ts` quando `origin === 'voice'`; chave `prompt.sdd.runner.mention.persona.voice` em `main.en.json` e `main.pt-BR.json`.
- `doorTable.ts`: texto de `EXCLUSION_REASONS.voice` atualizado.
- Testes: `forum-origin`, `persona-voice-prompt`.

### 3. Voz no chat
- Puros: `sentences.ts` (`nextSentences`), `voiceTurns.ts` (`createTurnTracker`), `speechFeed.ts` (`createSpeechFeed`), `voiceGate.ts`.
- `playback.ts`: `player.sayStream`. Hooks `useVoiceTurns`, `useVoiceGate`.
- `VoiceChatControls.tsx` (falar, mãos livres, modo de voz, nota do gate com botão para as configurações); `Composer` ganhou a prop `extra`; `ChatThread`/`ChatScreen`/`App` passam o player e a voz (`voiceOfAgent(persona.id)`).
- `ChatMessage.tsx`: marca "falado" na bolha (estilo `.chat-spoken` em `chat.css`, só com tokens).
- `Settings.tsx`: `ui.settings.voice.engineHintEdgePersona` com o motor Edge.
- Testes: `voice-sentences`, `voice-turns`, `voice-speech-feed`, `voice-gate`.

### 4. Modo de voz
- `voiceLoop.ts` (máquina de estados pura, `labelOf`), `useVoiceSession.ts`, `latency.ts`, `shortcut.ts` (`isVoiceShortcut`, Ctrl/Cmd+Shift+M).
- `VoiceModeScreen.tsx` + `voice-mode.css`; `Screen` ganhou `{ name: 'voice' }`; `useVoiceShortcut` em `App.tsx`.
- Linha de latência: `console.info` no renderer (não há canal de log do renderer para isso), marcada como texto de desenvolvedor para o i18n:lint.
- Testes: `voice-loop`, `voice-shortcut`, `voice-latency`.

### 5. Celular
- `pausePolicy.ts`; pausa por `visibilitychange` no navegador pareado; `wakeLock` enquanto o modo de voz está aberto e não pausado; mensagens `ui.voice.mic.insecure|denied|missing|unsupported`; botão de modo de voz em destaque no celular quando a voz está pronta.
- Teste: `voice-phone`.

### Documentação
- `docs/voice.md` (seção "Talking to the persona" e o que "off" significa agora no chat), `docs/persona.md` (PT e EN), `CHANGELOG.md` em `[Unreleased]`. O AGENTS.md não muda.

## Tentativa 3: base da release
- A integração devolveu porque a branch estava atrás de `origin/release/0.11.0` e a mesclagem de teste dava conflito em `CHANGELOG.md`. Conferido nesta tentativa: a branch continua 8 commits à frente e 11 atrás, e o `git merge-tree` acusa conflito só em `CHANGELOG.md`. Os outros arquivos (`docs/persona.md`, `docs/voice.md`, `answer.ts`, `call.ts`, `App.tsx`, `chat.css`, `main.*.json`) mesclam sozinhos.
- A base **não** foi trazida. Pelas regras do ciclo, merge, rebase e commit pelo shell não são permitidos; a base vem pela ferramenta de conflito do app.
- Para deixar a resolução trivial, o `CHANGELOG.md` da branch agora tem o bloco `[0.11.0-beta.5]` da release logo abaixo de `[Unreleased]`, e os links do rodapé estão como na release (`[Unreleased]` compara com `v0.11.0-beta.5`, mais o link novo de beta.5). A nossa linha continua em `[Unreleased]` > `### Added`.
- Teste de mesclagem com `git merge-file` em cópias fora da worktree: ainda há um conflito, porque os dois lados escrevem no mesmo ponto logo abaixo de `## [Unreleased]`. O lado da release nesse conflito ficou vazio, então a resolução é **manter o arquivo da branch como está**. Fora de `[Unreleased]`, o arquivo da branch é idêntico ao da release (ev-4).

## Verificação
- Tentativa 2: `npx tsc --noEmit` ok; `npx vitest run` nos arquivos de voz, origem, prompt, i18n e barge-in: 18 arquivos, 154 testes passam; `npm run i18n:lint` 0; `node scripts/public-audit.mjs` limpo; `node scripts/theme-audit.mjs` exit 0 (ev-1). Na suíte inteira, só falham os arquivos do navegador, por falta de `@playwright/mcp` na worktree (ambiente).
- Tentativa 3: `git rev-list --left-right --count` (8/11), `git merge-tree` (conflito só no CHANGELOG), `git merge-file` no CHANGELOG editado (ev-4), `node scripts/public-audit.mjs` limpo (2004 arquivos). tsc e vitest não foram rodados de novo: nesta tentativa só o CHANGELOG mudou.
- `electron-vite build`: rodado pela integração (exit 0), não nesta etapa.

## Não verificado
- Mesclagem real da base e os gates depois dela (tsc, testes de voz) com o código da release.
- O app rodando com voz instalada: aparência, foco e contraste do modo de voz, fluxo ponta a ponta (critérios 1, 2, 3), latência real (meta de 3 s), lacunas entre frases, barge-in com eco, celular real com https, colisão do atalho, o modelo seguir o prompt de voz (critérios 6 e 7).
- A regra "fala desligada não sintetiza" vive no player e não tem teste (o vitest roda sem DOM).

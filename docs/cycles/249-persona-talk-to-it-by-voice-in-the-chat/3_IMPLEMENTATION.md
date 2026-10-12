# Implementação: voz no chat da persona e modo de voz

Esta etapa rodou em quatro tentativas. A primeira deixou o código das cinco entregas e quatro testes (o app reiniciou no meio dela). A segunda completou os testes e a documentação e corrigiu o que os gates mostraram. A terceira e a quarta voltaram da integração só por causa da base. O app faz um commit só por etapa, não um por entrega como o plano previa.

## O que foi feito, por entrega do plano

### 1. Áudio compartilhado
- `src/renderer/src/voice/`: `playback.ts`, `recorder.ts`, `talk.ts`, `state.ts`; `audio.ts` só reexporta. Nenhuma tela de cerimônia mudou de import.
- O callback de silêncio do `useRecorder` recebe `{ reason: 'silence' | 'limit' | 'barge', heard }`.
- `micSupport.ts`: `micSupport`, `micEnvironment`, `explainMicError`.
- Testes: `voice-vad-discard`, `voice-mic-support`.

### 2. Origem "voz" e prompt
- `ForumMessage.origin?: 'voice'` e `messageOrigin()` em `src/shared/forum.ts`; `forum:post(thread, text, origin?)` em `forum.ts`/`forum-core.ts`; `forumApi.post(..., origin?)`.
- `MentionInput.persona.voice` em `call.ts`, ligado por `answer.ts` quando `origin === 'voice'`; chave `prompt.sdd.runner.mention.persona.voice` em `main.en.json` e `main.pt-BR.json`.
- `doorTable.ts`: texto de `EXCLUSION_REASONS.voice` atualizado.
- Testes: `forum-origin`, `persona-voice-prompt`.

### 3. Voz no chat
- Funções puras: `sentences.ts` (`nextSentences`), `voiceTurns.ts` (`createTurnTracker`), `speechFeed.ts` (`createSpeechFeed`), `voiceGate.ts`.
- `playback.ts`: `player.sayStream`. Hooks `useVoiceTurns` e `useVoiceGate`.
- `VoiceChatControls.tsx` (falar, mãos livres, modo de voz, nota do gate com botão para as configurações); o `Composer` ganhou a prop `extra`; `ChatThread`/`ChatScreen`/`App` passam o player e a voz (`voiceOfAgent(persona.id)`).
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

## Tentativa 4: base da release trazida
- Com a autorização da pessoa, só desta vez, para fazer a mesclagem pelo shell: `git merge --no-commit --no-ff origin/release/0.11.0`. Os oito arquivos que os dois lados mudaram se mesclaram sozinhos: `docs/persona.md`, `docs/voice.md`, `answer.ts`, `call.ts`, `App.tsx`, `chat.css` e `main.*.json`. O único conflito foi em `CHANGELOG.md`, e o lado da release nele estava vazio.
- Resolução: mantive o arquivo da branch (`git checkout --ours CHANGELOG.md`), sem marcadores de conflito. A linha da funcionalidade continua em `[Unreleased]` > `### Added`.
- Commit do merge: `053433c8` ("merge origin/release/0.11.0 into the voice branch"). Depois dele, a branch está 15 commits à frente e 0 atrás de `origin/release/0.11.0`.
- `CONFIG_SCHEMA_VERSION` continua 34 na branch e na release.

## Verificação (tentativa 4, depois da mesclagem; ev-9)
- `npx tsc --noEmit`: saída 0.
- `npx vitest run` nos testes de voz, origem, prompt, barge-in, i18n, ui-i18n, terminologia de voz e política web/persona: 20 arquivos, 191 testes, todos passam.
- `npm run i18n:lint`: 6301 chaves nos dois idiomas, nenhuma sem tradução.
- `node scripts/theme-audit.mjs`: saída 0.
- `node scripts/public-audit.mjs`: limpo, 2013 arquivos.
- Suíte inteira (`npx vitest run`): 553 arquivos passam e 5 falham.
  - 4 são os testes do navegador, que falham por falta de `@playwright/mcp` na worktree (ambiente).
  - O quinto é `modules-registered`. Rodado sozinho logo em seguida, passou (2/2). Não investiguei por que ele falhou na suíte inteira (pode ser carga).
- `electron-vite build`: não rodado nesta etapa. Antes da mesclagem, a integração o rodou com saída 0.

## Não verificado
- `electron-vite build` depois da mesclagem.
- O app rodando com voz instalada: aparência, foco e contraste do modo de voz, fluxo ponta a ponta (critérios 1, 2 e 3), latência real (meta de 3 s), lacunas entre frases, barge-in com eco, celular real com https, colisão do atalho e se o modelo segue o prompt de voz (critérios 6 e 7).
- A regra "fala desligada não sintetiza" vive no player e não tem teste (o vitest roda sem DOM).

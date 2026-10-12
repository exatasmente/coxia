# Implementação: voz no chat da persona e modo de voz

Esta etapa rodou em duas tentativas (o app reiniciou no meio da primeira). A primeira deixou o código das cinco entregas e quatro testes; a segunda completou os testes, a documentação e corrigiu o que os gates mostraram. O app faz um commit só para a etapa, não um por entrega como o plano previa.

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
- `VoiceChatControls.tsx` (falar, mãos livres, modo de voz, nota do gate com botão para as configurações); `Composer` ganhou a prop `extra`; `ChatThread`/`ChatScreen`/`App` passam player e voz (`voiceOfAgent(persona.id)`).
- `ChatMessage.tsx`: marca "falado" na bolha (estilo `.chat-spoken` em `chat.css`, só tokens, acrescentado nesta tentativa).
- `Settings.tsx`: `ui.settings.voice.engineHintEdgePersona` com o motor Edge.
- Testes (escritos nesta tentativa): `voice-sentences`, `voice-turns`, `voice-speech-feed`, `voice-gate`.

### 4. Modo de voz
- `voiceLoop.ts` (máquina de estados pura, `labelOf`), `useVoiceSession.ts`, `latency.ts`, `shortcut.ts` (`isVoiceShortcut`, Ctrl/Cmd+Shift+M).
- `VoiceModeScreen.tsx` + `voice-mode.css`; `Screen` ganhou `{ name: 'voice' }`; `useVoiceShortcut` em `App.tsx`.
- Linha de latência: `console.info` no renderer (não existe canal de log do renderer para isso), marcada como texto de desenvolvedor para o i18n:lint nesta tentativa.
- Testes (nesta tentativa): `voice-loop`, `voice-shortcut`, `voice-latency`.

### 5. Celular
- `pausePolicy.ts`; pausa por `visibilitychange` no navegador pareado; `wakeLock` enquanto o modo de voz está aberto e não pausado; mensagens `ui.voice.mic.insecure|denied|missing|unsupported`; botão de modo de voz em destaque no celular com voz pronta.
- Teste (nesta tentativa): `voice-phone`.

### Documentação
- `docs/voice.md` (seção "Talking to the persona" e o que "off" significa agora no chat), `docs/persona.md` (PT e EN), `CHANGELOG.md` em `[Unreleased]`. O AGENTS.md não muda.

## Itens "conferir na implementação"
- `origin` sobrevive ao armazenamento: coberto por `forum-origin` (passa).
- Configurações de voz: os controles abrem a tela `settings` (sem âncora de seção; a tela não tem uma).
- Canal de log do renderer: não existe; a latência vai para o console das ferramentas de desenvolvedor.
- `EXCLUSION_REASONS.voice` e prompts: a suíte passa com o texto novo (nenhuma falha nos testes de prompt e porta).

## Verificação (comandos rodados nesta tentativa)
- `npx tsc --noEmit`: ok.
- `npx vitest run` (suíte inteira): 3 testes falharam. `ui-i18n` (o lint achou a linha de log de latência): corrigido e reconferido, passa. `browser-quit`, `browser-sites` e os arquivos `browser-contract`/`browser-runtime`: falham porque o pacote local `@playwright/mcp` não está em `node_modules` desta worktree; sem relação com a mudança. A suíte inteira não foi rodada de novo depois da correção (só os arquivos afetados).
- `npx vitest run` nos arquivos de voz, origem, prompt, i18n e barge-in: 18 arquivos, 154 testes passam.
- `npm run i18n:lint`: 0. `node scripts/public-audit.mjs`: limpo. `node scripts/theme-audit.mjs`: exit 0, nenhum arquivo novo com cor literal.
- `electron-vite build`: não rodado.

## Não verificado
- O app rodando: nenhuma tela foi aberta nesta etapa (sem voz instalada no ambiente), então aparência, foco, contraste do modo de voz e o fluxo ponta a ponta (critérios 1, 2, 3) ficam para a etapa de teste.
- Latência real (meta de 3 s), lacunas entre frases, barge-in com eco, celular real com https, colisão do atalho com o Electron, o modelo seguir o prompt de voz (critérios 6 e 7).
- A regra "fala desligada não sintetiza" vive no hook `useVoiceTurns` e não tem teste (o vitest roda sem DOM).

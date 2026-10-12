# Plano: voz no chat da persona e modo de voz

Nota de método: tudo abaixo vem de leitura do código nesta etapa. Nada foi executado, compilado nem testado. O que depende de rodar o app (latência real, voz instalada, celular, o modelo seguindo o prompt) está marcado como **não verificado** e tem passo de verificação própria.

## O que o código mostra hoje (lido)

- **Áudio** (`src/renderer/src/audio.ts`, 571 linhas): `usePlayer` (`say` sempre faz `stop()` e recebe o texto inteiro; `planSpeech` divide em frases no processo principal), `useRecorder` (VAD, barge-in por `subscribeBarge`), `useTalk` (Espaço, ignorado em campos de texto), `transcribeAudio`. Há estado de módulo global (`active`, `audioCtx`, `speechOn`, `reading`, cache de frases). `bargeMonitor.ts` só abre o microfone depois que a primeira frase toca e só se alguma tela tem gravador inscrito; no iOS não há barge-in.
- **Enfileirar frases não existe**: `playSpeech` guarda `segments`, `slots` e `cursor` como locais. Falar por frase exige um caminho novo no player.
- **VAD** (`vad.ts`): só para por silêncio depois de ter ouvido fala (`heard`); sem fala, para por limite de 30 s (`maxMs`). Hoje o `onSilence` não diz o motivo, então um modo mãos livres transcreveria 30 s de silêncio a cada volta.
- **Telas de cerimônia**: uma instância de `usePlayer` em `App.tsx:102`, passada por prop. `Call`, `Gate`, `Conflict`, `Deep` repetem à mão o que `useTalk` faz; `QaHandoff`, `Reentry`, `RetroScreen` usam `useTalk`.
- **Chat da persona**: `ChatThread.tsx` monta o `Composer` (`inline`, anexar e enviar). Envio é o canal genérico `forum:post(thread, text)` (`forum.ts:126` → `personPost`), sem canal próprio da persona. Quem transforma a mensagem em turno é `mentions/answer.ts:346`, que já tem a mensagem em mãos e chama `mentionCall` (`call.ts:183`) com `persona: { buttons, tools }`. Prompts da persona ficam em `prompt.sdd.runner.mention.persona.*` (`main.en.json` e `main.pt-BR.json`, linhas 1099-1103).
- **Texto ao vivo**: `persona:live` já chega em deltas (`LiveEvent`: `offset` 0 substitui, outro valor anexa; `end` fecha), com releitura por `persona:live-read` (`liveApi.ts`). Não há evento por frase. A resposta final é gravada uma vez, inteira, com `answersTo`. Ou seja, a dependência da #247 já está no código; a fala por frase se faz no renderer, sobre os deltas.
- **Navegação**: `Screen` é uma união em `App.tsx:56`; atalhos são hooks de `keydown` por tela (`useHelpShortcut` F1, `usePromptsShortcut` Ctrl/Cmd+Shift+I). Não há atalho global do sistema nem menu.
- **Política web**: `voice:transcribe`, `voice:segment`, `voice:plan`, `voice:cancel`, `voice:status` abertos ao celular; `check|install|install-cancel|test|uninstall|enable` negados (`webPolicy.ts:17`). `forum:post` já é usado no celular.
- **Testes**: vitest em ambiente `node`, sem jsdom nem testing-library; nenhum teste renderiza componente (`chatModel.ts` diz o mesmo). Só `barge.ts` (função pura) tem teste de áudio. Não há fakes de `MediaRecorder`/`AudioContext`. Em consequência, **a lógica nova precisa estar em funções puras** e o que é DOM/áudio fica fino.
- **Catálogos**: `src/shared/i18n/{en,pt-BR}.json` e arquivos `ui-*.json`; prompts em `main.*.json`. Variante sem "call" é a chave com sufixo `.novoice` (`tv()`). Testes que cobrem: `i18n.test.ts`, `ui-i18n.test.ts`, `voice-terminology.test.ts`, `gitlab-catalogs-unchanged.test.ts` (chave nova é acréscimo, não quebra), `host-terms-leak.test.ts`.

## Decisões e motivos

1. **Sem canal IPC novo.** Origem "voz" entra como terceiro argumento opcional de `forum:post`; fala, gravação e transcrição usam os canais `voice:*` que já existem. Motivo: não mexe em `webPolicy.ts`, nem em `persona-policy.test.ts` / `plugins-web-policy.test.ts`, e o celular herda de graça.
2. **Origem é um campo próprio, `origin?: 'voice'`, em `ForumMessage`** (e no rascunho do `append`), validado no processo principal: só o valor `'voice'` é aceito, qualquer outro é ignorado. Alternativa descartada: `params.origin`, que aparece nas linhas de ato e mistura dado de apresentação com origem.
3. **A persona fala só as respostas a turnos que *este aparelho* enviou por voz.** Cada aparelho guarda o `seq` devolvido pelo `post`; o evento ao vivo vai para todos os navegadores pareados, e sem esse filtro computador e celular falariam juntos. Perguntas digitadas continuam sem áudio.
4. **"Sim" falado só vale para escolha sem efeito externo (regra 11).** O app não aprova nada por mensagem: aprovações com efeito externo passam por botão (`actions:approve`, `AskCard`, `OfferCard`). Então a garantia é estrutural; o prompt de turno de voz reforça dizendo que a confirmação está na tela e que um "sim" falado não a autoriza.
5. **Falar por frase no renderer, sobre os deltas.** Um separador puro de frases (`sentences.ts`) consome o texto ao vivo; cada frase vai a `voice:plan`/`voice:segment` e entra numa fila do player. Motivo: `planSpeech` e a limpeza de markdown (`speakable`) já são por texto no processo principal e não guardam estado, então chamar por frase serve sem mudar o processo principal. A limpeza de markdown continua só lá.
6. **Extração sem quebrar telas:** `audio.ts` vira uma pasta `src/renderer/src/voice/` com módulos (reprodução, gravação, fala por frase, estado) e `audio.ts` permanece como arquivo que reexporta tudo. Nenhum import das ~15 telas muda. As quatro telas que duplicam `useTalk` **não** são migradas (regra: cerimônias não mudam de comportamento).
7. **Mãos livres é uma máquina de estados pura** (`voiceLoop.ts`), usada pelo chat e pelo modo de voz; o hook só liga eventos reais a ela. É o que torna o comportamento testável no ambiente `node`.
8. **Controles de voz sempre visíveis no chat**, mas com estado: pronto, desligada, não instalada. Tocar em "desligada/não instalada" mostra o aviso com caminho para as configurações de voz e não abre microfone nem baixa nada. Nas cerimônias, o comportamento de esconder continua. Na cópia de teste do assistente de criação da persona (`compact`) os controles não aparecem.
9. **Voz da persona:** `voiceOfAgent(persona.id)` de `ceremony.ts:257` (o encaixe do agente na equipe, sempre a mesma voz).
10. **Atalho do modo de voz: Ctrl/Cmd+Shift+M**, no mesmo padrão dos hooks existentes (e fora do navegador pareado). Escolhida por não colidir com F1 nem Ctrl+Shift+I nem Ctrl+Shift+V (colar sem formatação). A colisão com outros atalhos do Electron não foi verificada.
11. **Latência (regra 12):** marcas de tempo por turno (`fim da fala → transcrito → enviado → 1º texto ao vivo → 1ª palavra tocando`), calculadas por função pura e registradas numa linha de log do renderer. A meta de 3 s é medida na etapa de teste; passar vira débito, não bloqueia.
12. **Celular (regra 13):** pausa por `visibilitychange` quando a página some; no computador não pausa. Uso de `wakeLock` quando o navegador oferece, só enquanto o modo de voz está aberto.

## Ordem das entregas

Cada entrega é um commit que passa em `tsc`, `vitest`, `theme-audit`, `i18n:lint` e `public-audit`.

### Entrega 1: áudio compartilhado (sem mudar comportamento)

- `src/renderer/src/voice/` novo, com o conteúdo de `audio.ts` dividido: `playback.ts` (`usePlayer`, cache, `playSpeech`, `speechBands`, `speechProgress`), `recorder.ts` (`useRecorder`, `transcribeAudio`), `talk.ts` (`useTalk`), `state.ts` (`speechOn`, eventos, `unlockAudio`). `audio.ts` fica só com `export * from './voice/...'` mais o `setBargeIn` já reexportado. `bargeMonitor.ts` mantém o lugar.
- `useRecorder`: o callback de silêncio passa a receber `{ reason: 'silence' | 'limit' | 'barge', heard: boolean }`; quem ignora o argumento (todas as telas de hoje) segue igual. `vadStep` não muda: a razão e `heard` já existem no estado.
- `micSupport()` (função pura em `voice/micSupport.ts`): recebe `{ isSecureContext, hasMediaDevices, hasMediaRecorder }` e devolve `'ok' | 'insecure' | 'unsupported'`; `explainMicError(error)` mapeia `NotAllowedError`/`NotFoundError`/outros para um código de mensagem. `useTalk` e os novos usos o chamam; as mensagens atuais das cerimônias não mudam.
- Testes: `test/voice-vad-discard.test.ts` (silêncio sem fala termina em `limit` com `heard=false`; com fala termina em `silence` com `heard=true`), `test/voice-mic-support.test.ts` (https/inseguro/sem API/permissão negada). Regressão: suíte atual inteira, `barge.test.ts` e `tsc` provam que nenhuma tela mudou de import.

### Entrega 2: origem "voz" e prompt de turno de voz (processo principal)

- `src/shared/forum.ts`: `origin?: 'voice'` em `ForumMessage` e no rascunho de `append`. Conferir que o armazenamento, a redação de segredos e a leitura preservam o campo (risco abaixo).
- `src/main/forum.ts`: `ctx.handle('forum:post', (thread, text, origin?))` aceita só `'voice'`; `personPost(..., origin)` grava; `attachmentPost` fica sem origem (anexo não é fala). Caminho do `interceptor` (resposta a pergunta de execução) segue como está.
- `src/renderer/src/screens/cycle/forumApi.ts`: `post(thread, text, origin?)`.
- `src/main/mentions/call.ts`: `MentionInput.persona` ganha `voice?: boolean`; `mentionCall` acrescenta `cp('runner.mention.persona.voice')` depois da linha de ferramentas. `src/main/mentions/answer.ts:362`: `voice: message.origin === 'voice'`.
- Catálogos `main.en.json` e `main.pt-BR.json`: `prompt.sdd.runner.mention.persona.voice`, dizendo: o pedido veio falado e pode ter erro de reconhecimento (pergunte se estiver em dúvida); responda curto, em frases, sem markdown, lista, tabela, bloco de código, endereço longo ou símbolo; uma ação longa se anuncia em uma frase antes e o resultado se resume, não se lê; confirmação com efeito fora do computador fica na tela e um "sim" falado não a autoriza; números e datas por extenso natural.
- `src/main/persona/doorTable.ts:265`: o texto de `EXCLUSION_REASONS.voice` (hoje "voice in the chat is a later issue") passa a dizer que voz e instalação ficam fora da porta da persona por decisão, não por falta de issue; o teste que compara esse texto é atualizado.
- Testes: `test/forum-origin.test.ts` (origem `'voice'` gravada e lida de volta; outro valor, ausente ou não-string ignorado; `attachmentPost` sem origem), `test/persona-voice-prompt.test.ts` (com `voice` o `system` contém a chave nos dois idiomas; sem `voice` o prompt é idêntico ao de antes; sem a palavra "call"), mais os testes de catálogo existentes.
- **Cobertura que não existe em teste:** que o modelo de fato responde curto e sem markdown (critérios 6 e 7) só se vê com modelo real. O teste prova o texto do prompt e a limpeza no processo principal; a resposta real fica para verificação manual.

### Entrega 3: voz no chat

- `src/renderer/src/voice/sentences.ts` (puro): `nextSentences(text, from, { final })` devolve as frases completas a partir do ponto já consumido e o novo ponto. Completa = terminador (`.`, `!`, `?`, `…`, quebra de linha) seguido de espaço ou fim; não corta em decimais (`3.5`), siglas comuns, `e.g.`, números ordinais; um bloco entre ``` é uma unidade só, emitida quando fecha, e tratada pelo `speakable` do processo principal (vira a frase traduzida de código). `final: true` solta o resto sem terminador.
- `src/renderer/src/voice/speechFeed.ts` + mudança em `playback.ts`: `player.sayStream(voice, who, opts)` devolve `{ push(text), end(), cancel() }`. `playSpeech` passa a ler segmentos de uma fila: cada `push` chama `voice:plan` por frase e anexa os segmentos e os `slots`; o laço de agendamento espera o próximo slot até `end()`. `startMonitor` (barge-in) liga na 1ª frase tocando e fica até o fim do fluxo, também entre frases. A síntese da frase seguinte já corre enquanto a atual toca (o `pump` existente). `say` existente não muda.
- `src/renderer/src/voice/voiceTurns.ts` (puro): `createTurnTracker()` com `mark(seq)` (turno enviado por voz neste aparelho), `feed(liveAnswers, storedMessages)` que devolve `{ speak: string[] , done: boolean }` por turno: frases novas do texto ao vivo; ao chegar a resposta gravada (`answersTo`), fala o que faltou do texto final e encerra; resposta interrompida (`INTERRUPTED_PARAM`) encerra o fluxo e para a voz; texto que reinicia (`offset` 0 com texto diferente do já falado) para e recomeça só do que não foi falado. Nunca fala duas vezes a mesma frase.
- `src/renderer/src/voice/useVoiceTurns.ts`: hook que liga `useLiveAnswers(thread)` + `useThread(thread)` ao tracker e ao `sayStream`. Respeita o interruptor de fala: com fala desligada, mostra o texto e não sintetiza.
- `src/renderer/src/voice/voiceGate.ts` (puro): `voiceGate({ status, isWeb })` devolve `{ kind: 'ready' | 'off' | 'missing' | 'web-off' }` a partir de `voice:status` (`enabled`, `depsInstalled`). `VoiceControls`/`VoiceChatControls.tsx`: botão de microfone (aperta e fala; solta ou silêncio envia), botão de mãos livres e botão do modo de voz, todos passando pelo gate. `off`/`missing`: nota inline com botão para as configurações de voz; `web-off` (celular): a nota diz que ligar a voz é no computador.
- `Composer.tsx`: nova prop `extra?: ReactNode` desenhada ao lado de anexar/enviar no modo `inline`; o `Composer` não conhece voz. `ChatThread.tsx`: passa os controles e `onVoiceText(text)` que chama `forumApi.post(thread, text, 'voice')` e `turns.mark(m.seq)`. `ChatScreen.tsx` e `App.tsx`: passam `player`, `voiceOfAgent` e `go`.
- `screens/persona/ChatMessage.tsx` (`PersonBubble`): marca discreta de "falado" na bolha de origem voz (rótulo acessível, sem cor literal).
- Configurações de voz (`Settings.tsx`, ao lado da dica do motor Edge): quando o motor é Edge, uma linha dizendo que as respostas da persona lidas em voz alta também vão para a Microsoft (regra 14). Chave nova `ui.settings.voice.engineHintEdgePersona`.
- Catálogos: chaves `ui.voice.chat.*` (mic, mãos livres, modo de voz, avisos de desligada/não instalada/celular), nos dois idiomas; onde a frase fala de "call", variante `.novoice`.
- Testes: `test/voice-sentences.test.ts` (frase completa só com terminador; decimal e sigla; bloco de código; quebra de linha; `final`; entrega em pedaços de 1 caractere dá o mesmo resultado que de uma vez), `test/voice-turns.test.ts` (só turnos marcados; 1ª frase sai antes de a resposta terminar [critério 5]; resposta gravada sem texto ao vivo é falada inteira; resposta interrompida; reinício do texto; sem repetir frase; fala desligada), `test/voice-speech-feed.test.ts` (fila em ordem; `end` sem frases; `cancel` descarta a que está sendo sintetizada; a camada de áudio é injetada com um falso), `test/voice-gate.test.ts` (estados e que `off`/`missing` não pedem microfone nem instalação [critério 8]).

### Entrega 4: modo de voz

- `src/renderer/src/voice/voiceLoop.ts` (puro): estados `idle | listening | transcribing | thinking | speaking | muted | paused`, eventos `start, heard, silence, transcribed(text), posted, answerStarted, speechStarted, speechEnded, bargeIn, mute, unmute, pause, resume, end, error`. Regras: silêncio sem fala (`heard=false`) volta a ouvir sem transcrever; texto vazio volta a ouvir; `bargeIn` em `speaking` para a fala e vai a `listening` já com o pré-roll; `muted` não abre microfone nem barge-in; `end` é terminal. Exporta `labelOf(state)` para o visual.
- `src/renderer/src/voice/useVoiceSession.ts`: liga a máquina a `useRecorder`, `transcribeAudio`, `forumApi.post(..., 'voice')`, `useVoiceTurns` e ao barge-in (reaproveitando `subscribeBarge`). Marcas de latência por turno.
- `src/renderer/src/screens/persona/VoiceModeScreen.tsx` (+ `voice-mode.css`): tela cheia, visual com o `Avatar` existente (`speechBands`) para falando e `level` do gravador para ouvindo, rótulo de estado (ouvindo / pensando / falando / pausado), legendas ligáveis (texto ao vivo da persona e a última fala da pessoa), botões silenciar microfone e encerrar, botão "toque para interromper" no iOS (sem barge-in lá). Cores só por tokens; foco visível; `aria-live` educado no estado.
- `App.tsx`: `Screen` ganha `{ name: 'voice' }`; `targetToScreen`/`parseTarget` não mudam (sem notificação push). `useVoiceShortcut(current, go)` (Ctrl/Cmd+Shift+M, não no navegador pareado) alterna entre o modo de voz e a casa. Botão ao lado do campo de texto (Entrega 3) abre a tela. Ao sair, a conversa já está no mesmo fio do chat: nada a copiar (critério 4).
- Sem voz instalada ou desligada: a tela nem inicia gravação; mostra o mesmo aviso do gate.
- Testes: `test/voice-loop.test.ts` (duas perguntas seguidas sem toque [critério 4]; barge-in; silenciar; encerrar; silêncio longo não transcreve; erro de transcrição volta a ouvir; `paused` só sai com `resume`), `test/voice-shortcut.test.ts` (função pura `isVoiceShortcut(event)`: combinação certa, repetição ignorada, sem Alt, não dentro do navegador pareado), `test/voice-latency.test.ts` (as marcas viram as durações; marca ausente não vira `NaN`).

### Entrega 5: celular

- `voice/micSupport.ts` (Entrega 1) alimenta `ui.voice.mic.insecure` ("o navegador só grava em conexão https; abra o endereço seguro do Coxia") e `ui.voice.mic.denied` (permissão negada, como liberar), no lugar do "microfone indisponível" genérico, só nos controles novos (as cerimônias mantêm a mensagem de hoje).
- `voice/pausePolicy.ts` (puro): `pausePolicy({ phone, visibility })` → `'pause' | 'keep'`. `useVoiceSession`: página oculta no celular emite `pause` (fecha microfone, para a fala, estado "pausado" com um toque para retomar); computador segue ouvindo e mostra o microfone aberto. `wakeLock` pedido ao abrir o modo de voz e solto ao sair/pausar, ignorado sem suporte.
- Entrada principal no celular: com a voz pronta, o modo de voz é o botão principal do campo de texto na tela da persona e o item de destaque da folha de navegação.
- Testes: `test/voice-phone.test.ts` (`pausePolicy`; que `micSupport` insegura gera a mensagem com motivo [critério 10]; que "pausado" só sai com retomar [critério 11]). Gravação em celular real com https não é testável em `node`: **não verificado até haver aparelho**.

## Documentação

`docs/voice.md` (chat, modo de voz, aviso do Edge, celular), `docs/persona.md` (seções PT e EN do chat e do celular pareado; remover "voz é issue futura"), `CHANGELOG.md` em `[Unreleased]`, e o `AGENTS.md` não muda (nenhuma instrução universal fica falsa).

## Riscos e como se evitam

| Risco | Como se evita ou confere |
|---|---|
| O campo novo `origin` ser descartado pelo armazenamento do fórum, pela redação de segredos ou pela leitura | A Entrega 2 começa por um teste que grava e lê de volta; se o `append` normaliza o rascunho, o campo entra na lista dele. |
| Falar duas vezes (computador e celular, ou texto ao vivo e resposta gravada) | Só o aparelho que enviou fala; o rastreador guarda o que já foi falado por turno e é testado em `voice-turns`. |
| Eco da própria voz virar "pedido" no mãos livres | Cancelamento de eco do microfone, nível mínimo em `barge.ts` (já existentes); o microfone só escuta depois da fala ou durante o barge-in. Sem fones, a verificação é manual e fica **não verificada**. |
| Silêncio sendo transcrito sem parar | `heard=false` descarta sem transcrever (Entrega 1 e `voiceLoop`). |
| Erro de transcrição virar ação com efeito externo | Aprovações com efeito externo são por botão; o prompt diz que "sim" falado não autoriza (decisão 4). A persona ainda age dentro da política de autonomia existente: não alterada aqui. |
| Frase cortada no meio (decimal, sigla, bloco de código) | Separador testado com entrega em pedaços; o que sobra sai em `final`. |
| Lacunas na voz entre frases | A fila reutiliza o agendamento por relógio de áudio e a síntese antecipada; a lacuna real só se mede com voz instalada: **não verificado**. |
| Latência acima de 3 s | Medida por turno; resposta curta já vem do prompt; passar da meta é débito registrado, não bloqueio (regra 12). Valor real **não verificado**. |
| Quebrar cerimônias na extração | Reexport mantém todos os imports; as quatro telas duplicadas não são tocadas; suíte atual e `tsc` na Entrega 1, antes de qualquer recurso novo. |
| O modelo ignorar o prompt de voz (markdown, resposta longa) | Prompt testado por texto; a limpeza de markdown no processo principal continua como rede de proteção, então símbolos não são lidos mesmo assim (critério 6 parcial). |
| Chaves novas quebrarem testes de catálogo | Duas línguas, mesmos marcadores, `.novoice` onde dizer "call"; `i18n:lint` e `voice-terminology`. O prompt de voz só entra em turno de voz, mas o teste que exige variante sem voz nos prompts deve ser conferido na Entrega 2. |
| Privacidade com o motor Edge | Aviso explícito nas configurações (regra 14) e na documentação; fala desligada não sintetiza nada. |
| Quem migrou com voz ligada ganha microfone no chat | O microfone só abre por toque; a permissão do sistema é pedida no primeiro uso; nada fica escutando sem o modo mãos livres ou modo de voz estar visível. |
| Colisão do atalho | Escolha registrada; conferir no app na etapa de teste. |

## Critérios de aceite: cobertura

| # | Critério | Cobertura |
|---|---|---|
| 1 | Microfone no chat, pedido transcrito, executado, respondido em voz | Funções puras e fila por teste; ponta a ponta com voz real: **verificação manual, não verificada** |
| 2 | Falar interrompe | `voiceLoop` (barge-in); áudio real manual |
| 3 | Modo de voz: estados, legendas, silenciar, encerrar | Estados por `voiceLoop`; aparência por conferência visual na etapa de teste |
| 4 | Duas perguntas seguidas, tudo no chat | `voiceLoop` + `forum-origin`; mesmo fio por construção |
| 5 | Voz antes do fim do texto | `voice-turns` |
| 6 | Sem markdown lido | Prompt (`persona-voice-prompt`) e limpeza existente; resposta do modelo real: manual |
| 7 | Ação longa: aviso e resumo | Só o texto do prompt é testável; o comportamento do modelo é manual |
| 8 | Voz desligada/não instalada | `voice-gate` |
| 9 | "Sim" falado não aprova efeito externo | Estrutural (botão); prompt testado |
| 10 | Celular: https e mensagem | `voice-mic-support`, `voice-phone`; aparelho real não verificado |
| 11 | Celular bloqueado: "pausado" | `pausePolicy`, `voiceLoop`; aparelho real não verificado |
| 12 | Latência medida e registrada | `voice-latency` prova a conta; valor real exige voz instalada na etapa de teste |
| 13 | Cerimônias iguais | Suíte atual, reexport, nenhuma tela migrada |
| 14 | Textos nos dois idiomas | `i18n.test`, `ui-i18n.test`, `voice-terminology`, `i18n:lint` |

## Dúvidas de escopo

Nenhuma que bloqueie. As propostas 11, 12 e 13 da especificação valem como escritas; este plano as implementa nesses termos.

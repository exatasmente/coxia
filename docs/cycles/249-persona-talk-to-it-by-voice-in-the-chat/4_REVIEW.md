# Revisão: voz no chat da persona e modo de voz

## Veredito
Aprovado. Nenhum achado bloqueante.

## Como foi revisado
Leitura do diff contra 1_SPEC.md e 2_PLAN.md. Lidos por inteiro: `useVoiceSession.ts`, `useVoiceTurns.ts`, `voiceTurns.ts`, e os trechos de `forum.ts`, `forum-core.ts`, `call.ts`, `answer.ts`, `playback.ts` (sayStream) e `audio.ts`. Nada foi executado nesta etapa: `tsc`, `vitest`, `i18n:lint`, `public-audit` e `theme-audit` passando é o que a implementação relatou, **não reconferido aqui**. Não foi aberto o app, e `electron-vite build` não foi rodado.

## O que confere (leitura)
- **Origem "voz"**: só o valor `'voice'` é aceito (`messageOrigin`), só em post de pessoa; o esquema do armazenamento ganhou o campo; o anexo não leva origem. Sem canal IPC novo, então a política web não muda.
- **Prompt de voz**: entra só quando `message.origin === 'voice'`; sem a flag, o prompt é o de antes. O "sim" falado não aprova nada com efeito externo por construção (aprovação é por botão) e o prompt reforça.
- **Só o aparelho que enviou fala**: o rastreador só segue `seq` marcados localmente; não repete frase; resposta interrompida cancela o fluxo; turno que some é encerrado por prazo.
- **Voz desligada**: `sayStream` devolve fluxo silencioso sem voz ou com fala desligada; o gate impede microfone e download.
- **Extração**: `audio.ts` só reexporta; nenhuma tela de cerimônia mudou de import.
- **Repositório público e regras**: textos nos dois catálogos, linha de log marcada como texto de desenvolvedor, CHANGELOG em `[Unreleased]`, docs atualizadas.

## Sugestões (não bloqueiam)
1. `useVoiceTurns.ts:40`: a regra "fala desligada não sintetiza" fica no player (`playback.ts:335`) e não tem teste; um teste do `sayStream` com `speechEnabled` falso e a camada de áudio injetada fecharia a lacuna que a implementação já reconhece.
2. `useVoiceSession.ts:118`: a latência só vai ao console. Para o critério 12 a etapa de teste precisa ler o console; se isso for difícil, vale um canal de log do renderer depois.
3. `useVoiceSession.ts:115-120`: a marca de primeira palavra depende de `player.speaking === who` e de `phase === 'thinking'`; se o player de uma cerimônia estiver falando com o mesmo `who`, a marca sai errada. Improvável, mas é acoplamento implícito.
4. `VoiceChatControls.tsx`: `stateText`, `gateMessage` e `GateNote` são exportados deste arquivo e usados pela tela de modo de voz; separar em módulo próprio deixaria as fronteiras mais claras.

## Não verificado
Tudo o que exige o app com voz instalada: critérios 1, 2, 3, 5 (na prática), 6, 7, 10, 11 e 12 em funcionamento real; lacunas entre frases; barge-in com eco; colisão de Ctrl/Cmd+Shift+M; aparência e contraste do modo de voz; `electron-vite build`. Os testes do navegador falham por falta de `@playwright/mcp` na worktree (relato da implementação, não reconferido).

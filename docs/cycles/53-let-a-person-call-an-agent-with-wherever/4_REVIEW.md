# Revisão: `@` chamando um agente onde a pessoa escreve

## Veredito

**Mudanças necessárias.** A entrega segue o plano e cobre a maior parte da spec, mas quatro pontos bloqueiam o aceite: a fronteira de segurança de um agente com `shell: host` chamado fora da thread de uma execução, e o registro da resposta do agente nomeado em três cerimônias (handoff de QA, retro e aprofundamento). Os gates também não foram rerodados nesta etapa.

## O que confere com a spec e o plano

- **Uma regra só.** O núcleo em `src/main/mentions/` (lugar, chamada, laço, módulo e cerimônias) é compartilhado entre a thread de uma execução (runner), o resto do fórum (módulo novo) e as cerimônias, como a seção 2 do plano descreve.
- **A thread de uma execução não mudou de dono.** O runner continua com o `openStageSandbox`, a etapa do fluxo e o publicador; `answerMention` (service.ts:939-959) monta o lugar de execução e delega o laço. O `answerPost` continua devolvendo `null` quando o texto tem menção.
- **Sem laço.** O módulo responde só `author.type === 'person' && kind === 'post'` (module.ts:22-25); a resposta do agente é postada com `author: { type: 'agent' }` e `mentions` vazio (answer.ts:125), então não chama outro agente.
- **O módulo nunca responde `run-`.** module.ts:31 descarta a thread `run-`, e `placeOfThread` devolve um lugar de execução que o módulo também descarta (module.ts:33).
- **Somente leitura.** A chamada força `permission: 'read'` (answer.ts:85) e não passa `confine`, então o agente não tem Edit/Write.
- **Nada novo escreve no host de código fora de Ações.** O módulo só acrescenta posts e linhas de sistema no fórum local; a proposta de issue só existe no lugar de execução, pelo publicador (answer.ts:68-72, 126-128). O comentário novo em `webPolicy.ts` não muda canal nenhum.
- **O rótulo da tela.** `Thread.tsx:78-83` mostra "Chamado" só para post de pessoa, corta em `MAX_MENTIONS` e usa `ui.forum.mentionsOverLimit` para o resto. A linha de nome desconhecido vem do `personPost` (forum.ts:38-39), com `unknownMentions` reusando a fronteira de `parseMentions`.
- **A cópia descartável.** Fora de uma execução, `shellSourceOf` (answer.ts:152-161) copia os repositórios do lugar com `copyTree` e o `finally` remove a pasta ao fim (answer.ts:136).

## O que bloqueia

### 1. Comandos de host sem a confirmação da pessoa, fora de uma execução

Na thread de uma execução, um agente com `shell: host` tem cada comando aprovado pela pessoa: `openStageSandbox` passa `approve: hostApproval(...)` (executor.ts:269) e a política trata `runs:command` como efeito externo (webPolicy.ts:20). Fora da thread de uma execução, o laço chama `openMentionSession`, que abre o host sem `approve` (answer.ts:180). Em `host.ts:82`, sem `approve`, o comando é liberado direto. Logo, um `@agente` num canal, numa conversa geral ou numa cerimônia pode rodar comandos no computador da pessoa sem nenhuma confirmação, e `forum:post` é aberto ao navegador pareado (webPolicy.ts:22-24) — pelo telefone também. É um afrouxamento da fronteira de segurança que a própria issue manda manter igual à da thread de uma execução.

### 2. Handoff de QA: a resposta do agente nomeado é descartada

`askQa` calcula `mentioned` (qa.ts:115) e o resultado nunca entra em `q.talk` (qa.ts:123). A resposta do agente nomeado some do registro e da tela. A aceitação 4 exige que ela "entra nos registros com o nome do agente"; o plano (§5.5) manda empilhar em `q.talk`.

### 3. Retro: a resposta do agente nomeado é descartada

O mesmo em `askRetro` (retro.ts:181 calcula, retro.ts:189 não usa). O plano manda empilhar em `retro.talk` antes de `proposeRetroIssues`.

### 4. Aprofundamento: a resposta é falada, mas não é gravada

Em `Deep.tsx`, `done` fala a resposta de cada agente nomeado (Deep.tsx:92-95), mas a atualização do estado grava só a resposta do agente do sistema (Deep.tsx:68-73). A resposta do agente nomeado não entra em `DeepState.msgs`, então o registro da cerimônia não a guarda e ela se perde ao recarregar. A aceitação 4 exige que a resposta entre nos registros com o nome do agente.

### 5. Os gates não foram rerodados

O relato da implementação diz que os gates passaram, com uma instabilidade de dois testes do runner tratada como ambiente. Nesta revisão nada foi executado: não houve `tsc`, `vitest`, os audits nem o build. O `askQa`/`askRetro` acima deixa `mentioned` sem uso, o que passa porque o `tsconfig` não liga `noUnusedLocals` — mas mostra que o caso não é coberto por teste.

## Sugestões

- **A conversa da cerimônia não chega ao agente nomeado no call diário e no aprofundamento.** `reply` e `deepAsk` passam `msgs: []` (agents.ts:668, 713), então o agente nomeado só recebe o cartão. O restante das cerimônias passa a conversa. A Regra do spec pede "o cartão ou a issue em discussão é o contexto, junto da conversa da cerimônia".
- **A fala do agente nomeado nas telas de QA, retro e reentrada.** Essas telas falam só o último item de `talk` com uma voz fixa (QaHandoff.tsx:48-49, RetroScreen.tsx:66-67, Reentry.tsx:68-69); mesmo com o item no registro, a resposta do agente nomeado não é falada com a voz dele como a aceitação 4 pede. O aprofundamento (Deep.tsx) e o call diário (Call.tsx:211-215) já falam por agente.
- **A thread de uma execução ganhou uma linha que não tinha.** `shellSourceOf` devolve `null` quando o worktree sumiu e o lugar de execução não tem repositórios, e o laço acrescenta `runner.mention.noShell` (answer.ts:95-96). Antes, um worktree ausente não gerava linha nenhuma. É pequeno, mas é uma mudança no caminho que a spec manda deixar como está.

## O que não foi revisado

- Nada foi executado: os gates do repositório não foram rerodados nesta revisão, o aplicativo não foi aberto, nenhum modelo real foi chamado e o telefone pareado não foi exercitado.
- O sandbox real nunca foi aberto sobre a pasta de rascunho de vários repositórios; o comportamento real de bwrap sobre essa cópia não foi visto.
- A fala e a ordem de fala das seis telas de cerimônia foram lidas no código, não vistas funcionando.
- O texto de sistema por lugar (`runner.mention.place.*`) não foi verificado com um modelo real.

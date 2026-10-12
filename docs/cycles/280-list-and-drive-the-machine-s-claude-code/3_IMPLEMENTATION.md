# Sessões do Claude Code no app: implementação

## O que foi feito

Os passos 1 a 7 de 2_PLAN.md, sobre o passo 0 feito na tentativa anterior.

1. **Configuração**: `claudeSessions: { enabled }`, padrão `false`. `CONFIG_SCHEMA_VERSION` 35, `v34ToV35` em `STEPS` (mantém uma seção já gravada, deixa uma nota), mais `types.ts`, `defaults.ts`, `schema.ts` e o histórico do esquema em `migrations.ts` e `docs/configuration.md`.
2. **Fronteira**:
   - `CLAUDE_SESSIONS = /^claudeSessions:/` na cadeia de negação de `webAccess`.
   - Os 12 canais em `EXCLUDED` com motivo `machine`.
   - `settingsGuard` recusa a mudança de `claudeSessions` pela persona.
   - Contagens de `persona-door-table.test.ts`: 321 canais e 127 exclusões.
3. **Emissor da janela**: `ModuleContext.emitWindow?` (opcional, para não quebrar os contextos falsos dos testes), implementado em `index.ts` só com `webContents.send`. O módulo nunca usa `emit` nem `notify`, que alcançam o celular.
4. **Núcleo** em `src/main/claudeSessions/`:
   - `source.ts`: `guardedRead` é o único ponto que lê disco. Aceita só `sessions/<dígitos>.json` direto na pasta, como arquivo regular (não segue link), e devolve só `pid, sessionId, cwd, kind, status, updatedAt`. `liveSessions` confere `process.kill(pid,0)`; transcrições e mensagens vêm do SDK.
   - `asks-core.ts`: fila de permissões no modelo de `turnAsks-core`. A resposta só vale pela janela (`door`); abortar a vez ou o fim do processo nega, sem auditoria.
   - `owned.ts`: registro dos processos iniciados pelo app e fila de entrada (o `query` em modo de entrada contínua fica vivo entre mensagens). A #282 lê este registro.
   - `service.ts`: `list`, `read`, `follow` (relê a cada 2 s e só emite quando muda), `send` (retoma a sessão; usa `forkSession` quando um `<pid>.json` vivo segura a sessão), `answer`, `pending`, `stop` (`interrupt`), `end` (só processo do app), `start` (só pasta de `projects.repos`), `shutdown`.
   - No serviço, `test:true` recusa `send` e `start` antes de criar o `query`. Todo texto que sai (linhas, título, primeiro pedido, pasta, branch, entrada da permissão, erros do SDK) passa por `redact`.
   - `module.ts`: registra os 12 canais. Desligado, todo canal menos `enabled` e `set-enabled` recusa; qualquer porta que não seja a janela recusa todos. Desligar encerra até um processo cujo id ainda não chegou. `auditClaudeSession` grava as linhas.
5. **Auditoria**: tipo `claude-session`, `target` `claude:<id>`, campos `action` (message, permission, stop, start), `through`, tamanho e `forked`/`of`, sem o texto. O rótulo está em `Auditoria.tsx` e nos dois catálogos.
6. **Tela**: `screens/ClaudeSessions.tsx`, que mostra a sessão aberta com `ActivityTree` e `buildTree`. Usa o modelo puro `claudeSessionsView.ts`, a API `claudeSessionsApi.ts` (`useClaudeSessionsOn` é sempre falso no navegador pareado) e a seção `ClaudeSessionsSection.tsx` em Configurações. A linha do menu (`navGroups(..., claude)`), a rota e o ícone só aparecem com o recurso ligado. Textos estão nos catálogos en e pt-BR; cores só por tokens.
7. **Documentação**: `docs/claude-sessions.md` (pt-BR e en), linha em `docs/README.md`, `docs/configuration.md` (esquema 35) e `CHANGELOG.md` (Unreleased). O `AGENTS.md` não muda.

## Desvio do plano

Os canais ficam registrados sempre e recusam quando o recurso está desligado. O plano dizia "não registra nada". Assim, ligar ou desligar não exige reiniciar o app. O critério 1 ("nenhum canal respondendo") vale, porque todo canal recusa.

## Ordem de entrada e esquema (tentativa 3)

A integração devolveu o trabalho porque esta branch e a da #282 usam o mesmo passo `v34ToV35`. A decisão da pessoa foi que a #280 entra primeiro. Por isso esta branch mantém o esquema 35, e o código não mudou nesta tentativa.

Conferido nesta tentativa com `git grep` (ev-7):

- Esta branch: `CONFIG_SCHEMA_VERSION = 35` (`types.ts:7`) e `v34ToV35` (`migrations.ts:500`).
- #282 (d434be69): também `CONFIG_SCHEMA_VERSION = 35` e `v34ToV35`. A colisão existe.
- `origin/release/0.11.0`: `CONFIG_SCHEMA_VERSION = 34`, então 35 é o próximo número certo para esta branch.

Quem renumera é a #282, depois que esta branch entrar na release:

- `CONFIG_SCHEMA_VERSION` 36 e um passo `v35ToV36` em `STEPS`;
- `types.ts`, o comentário de histórico em `migrations.ts` e `docs/configuration.md`;
- `test/config-migrations.test.ts`.

Isso fica fora deste ciclo.

## Testes (todos com fakes; nada de `~/.claude`)

- `test/claude-sessions-source.test.ts`: `guardedRead` recusa credenciais, `.key`, `control.key`, outros nomes, caminho fora da pasta e link para uma chave. Também cobre os campos permitidos, vivos e mortos, e a divisão entre em execução e em segundo plano.
- `test/claude-sessions-asks.test.ts`: pendente, permitir, negar, recusa de `paired` e `persona`, decisão inválida, abortar e fim do processo.
- `test/claude-sessions-service.test.ts`:
  - listar com ocultação e CLI ausente; ler com segredo oculto; acompanhar só quando muda;
  - retomar; enviar para uma cópia quando a sessão está presa; segunda mensagem no mesmo processo; `busy`, vazio e desconhecido;
  - permissão pendente com negar, permitir e porta errada;
  - parar; encerrar só o que é do app; iniciar só em pasta do workspace; `test:true`;
  - desligar antes do id; erro do SDK oculto; auditoria sem o texto.
- `test/claude-sessions-module.test.ts`:
  - padrão desligado; desligado recusa; ligar e desligar;
  - eventos só em `emitWindow`; recusa a `paired` e `persona`;
  - política do celular para cada canal servido e para um inventado; recusa pela porta HTTP real;
  - módulo na lista; cada canal em `EXCLUDED`; quatro linhas de auditoria reais;
  - só `source.ts` importa `fs`.
- `test/claude-sessions-view.test.ts`: grupos, linhas, controles (parar, encerrar, cópia), pedidos da sessão e da cópia, recusas em palavras, linha do menu só ligada.
- Ajustados: `config-migrations.test.ts` (bloco 34→35), `persona-door-table.test.ts` (contagens), `persona-worded.test.ts` (asks-core listado), `mentions-module.test.ts` (`emitWindow`).

## Portões

Na tentativa 2:

- `npx tsc --noEmit`: passou.
- `npx vitest run`: na rodada final, 560 arquivos passaram. Dois arquivos falharam por estourar o limite de 5 s com a máquina carregada: `modules-registered.test.ts` e `agent-assist-prompts.test.ts`. Rodados sozinhos em seguida, os dois passaram (38 testes).
- `node scripts/theme-audit.mjs`, `npm run i18n:lint` e `node scripts/public-audit.mjs`: passaram.

Na tentativa 3 o código não mudou, então nenhum portão foi rodado de novo. Só o `git grep` do esquema rodou (ev-7).

## Não verificado

- Nada contra o Claude Code real: listar, enviar, cópia, permissão, parar e iniciar dependem de uma pessoa com o `claude` instalado e logado (critérios 2 a 6 e 8).
- A tela não foi aberta num app em execução.
- Os pull requests abertos para a release não foram consultados. A ordem de entrada vem da decisão da pessoa.
- Um pedido de permissão só aparece para uma sessão que o app conduz; uma sessão aberta num terminal pergunta no próprio terminal.
- "Sem login" só aparece quando o SDK recusa; o app não confere a credencial.
- Uma linha de auditoria não é gravada quando o envio ou o início falha depois de entregar o texto ao SDK, nem quando `interrupt` lança erro.

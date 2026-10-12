# Etapas de um agente aparecem em claude.ai/code, só para leitura

## Tentativa 7: a base medida contra a release

A integração devolveu o trabalho porque o PR conflita com `release/0.11.0` e a base não tinha sido medida. Nesta tentativa o git funcionou no shell. A medição está em ev-12:

- A branch está 12 commits à frente e 32 atrás de `origin/release/0.11.0`.
- `git merge-tree --write-tree HEAD origin/release/0.11.0` acusa conflito só em `CHANGELOG.md`. `agents.ts`, `engine/contract.ts`, `runner/executor.ts` e os catálogos `main` e `ui-today` (en e pt-BR) se mesclam sozinhos.
- O esquema da release continua em `CONFIG_SCHEMA_VERSION = 34`, e o último passo é v33→v34. O passo v34→v35 desta branch está livre, então nada é renumerado.

### O conflito do CHANGELOG

As duas branches acrescentam texto logo abaixo de `## [Unreleased]`. A release traz as seções `[0.11.0-beta.6]` e `[0.11.0-beta.5]` e atualiza os links do fim do arquivo. Esta branch traz um `### Added` com a linha do Remote Control.

Para resolver: fica o arquivo da release, com o bloco `### Added` desta branch logo abaixo de `## [Unreleased]` e acima de `## [0.11.0-beta.6]`.

A resolução não ficou no worktree. Pô-la só no arquivo da branch não tira o conflito: `git merge-file` com essa versão continuou acusando conflito, porque as duas inserções caem no mesmo ponto. Ela também faria o PR mostrar as seções beta como novas. A mudança foi desfeita, e o conflito tem de ser resolvido no merge da base, pela ferramenta de conflito do app. Essa ferramenta não está entre as desta etapa. A regra do ciclo proíbe merge, rebase e commit pelo shell.

Nesta tentativa nenhum arquivo de código mudou.

## Decisões tomadas na implementação (confirmadas pela revisão)

1. **Token**: a credencial OAuth que o Claude Code já guarda no computador. Ela é lida quando uma sessão abre e nunca é guardada nem registrada. Se faltar, a etapa roda sem ponte.
2. **Só o espelho**: os níveis são `off` e `mirror`. A ponte é anexada com `outboundOnly: true`, e o que chegar por ela é descartado.
3. **Critério 3**: a primeira mensagem de toda sessão espelhada diz que ela é somente leitura, e a entrada nunca chega à sessão. Desvio aceito do texto literal.
4. **Falhas da ponte**: a etapa roda sem ponte, com uma linha na conversa, e não há auditoria.
5. **Fim da sessão**: `close()` quando a tentativa termina, sem arquivar.
6. **Escopo**: só as etapas de uma execução abrem a ponte.
7. **Precedência**: `resolveRemoteControl` aceita um nível da execução que só pode baixar o do agente. A interface ainda não oferece a escolha por execução.

## O que mudou (tentativas anteriores)

- **Política pura**: `src/shared/remoteControl.ts`.
- **Ponte**: `src/main/remoteBridge.ts`, o único módulo que importa `@anthropic-ai/claude-agent-sdk/bridge`. `createRemoteControlPort` consulta `isTestWorkspace` por padrão.
- **Motor**: `EngineRequest.mirror` (`engine/contract.ts`) e o repasse em `agents.ts`.
- **Runner**: `executor.ts`, `service.ts` e `module.ts`.
- **Configuração**: `AgentDef.remoteControl`, o schema, a migração v34→v35 e `newAgent`.
- **Fronteira**: `configScope.ts` (`remoteControlRaised`), `webPolicy.ts` (`REMOTE_CONTROL_ADMIN`) e `cycles/apply.ts`.
- **Auditoria**: o tipo `remote-control` em `shared/auditoria.ts` e em `Auditoria.tsx`.
- **Interface**: `RemoteControlField` no editor de agente, com textos em `en` e `pt-BR`.
- **Documentação**: `CHANGELOG.md` (Unreleased) e `docs/configuration.md`.

## Testes

`test/remote-control-policy.test.ts`, `test/remote-control-bridge.test.ts`, `test/runner-remote-control.test.ts`, `test/remote-control-ui.test.ts` e `test/config-migrations.test.ts` (passo v34→v35).

## Verificado nesta tentativa

- `git rev-list`, `git merge-tree` e a leitura do esquema da release, guardados em ev-12.
- `git merge-file` com a resolução candidata do CHANGELOG: o conflito continua (saída 1).

Os gates não rodaram de novo nesta tentativa, porque o código não mudou. A integração os deixou verdes (ev-11).

## Não verificado

- O merge real da base e os gates depois dele.
- Os critérios 1 e 3 contra a conta real, e a sessão no app Claude do celular.
- A renovação da credencial do worker em etapas longas.
- A interface no app em execução.

## Fora desta entrega

O modo control, a escolha por execução na interface (critério 10), a tela de sessões (critério 9) e o arquivamento das sessões.

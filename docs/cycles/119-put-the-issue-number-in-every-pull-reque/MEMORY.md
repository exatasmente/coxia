# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade (`enhancement`), completo, sem pergunta pendente para quem abriu nem para a pessoa (a etapa não pausou).
- Sugestão de prioridade no documento (não decidida aqui): `priority:medium` — mudança pequena e localizada, mas mexe na convenção de histórico de todo repositório que use o runner.

## Restrições

- A triagem só leu código: nada foi executado, nenhum comportamento foi reproduzido; na triagem, todo o estado atual vale como leitura.
- O campo novo `prTitle` precisa entrar na lista de caminhos que o `config:cycle-save` aceita (`docs/configuration.md:118`, aplicado em `src/main/configScope.ts`); fora dela, a tela Time no navegador não salva o campo.
- A regra `real-issue-number` da auditoria pública (`scripts/public-audit.mjs`, regras codificadas) inclui o número 123 usado nos exemplos de aceitação da issue: um teste ou documento com `#123` reprova `node scripts/public-audit.mjs`. Os exemplos devem usar número neutro (`#321`, `#456`); a lista de permissão casa por `text.includes(match)` na linha inteira e liberar `#123` libera o resto da linha junto.
- O `#123` do próprio `0_ISSUE.md` não é alcançável por lista de permissão sem esse efeito colateral.
- Documentos e testes que a mudança obriga a mover, conferidos por leitura: `test/runner-config.test.ts:12` (fixa o objeto `runner` inteiro do padrão), `test/runner-units.test.ts:230` (fixa a substituição do molde), `docs/configuration.md:42/46/73/118`, `docs/runner.md:92/310`, `CHANGELOG.md` em `## [Unreleased]` e os dois catálogos (`ui-team.en.json`, `ui-team.pt-BR.json`).

## Tentado e descartado

- Nada foi tentado nesta etapa; nenhuma solução foi projetada nem nenhuma prioridade foi decidida.

## Perguntas abertas

- Nenhuma para quem abriu ou para a pessoa. Ficam para o desenho, no refino: onde a resolução de conflito lê o número da issue e o config, e onde o passo novo de migração entra na cadeia que hoje termina na v12.

## Onde o trabalho está

- Etapa concluída: `0_TRIAGE.md` escrito na pasta do ciclo, com o tipo, o que foi conferido por leitura, o que falta e as issues relacionadas (nenhuma parece duplicar).
- Conferido por leitura: a validação só exige `{summary}` (`src/shared/config/validate.ts:143-144`); o padrão do molde é `feat: {summary} #{iid}` (`src/shared/config/defaults.ts:30`) e `commitMessage` já larga o `#` quando `iid` é 0 (`src/main/runner/git.ts:144`); o título do rascunho e o da proposta nunca levam o número (`src/main/runner/publish.ts:673` e `:691`, `createMr` em `:696-697`); os commits de etapa, registro da issue, registro da release (iid 0) e memória passam por `commitMessage` (`src/main/runner/executor.ts:492`; `src/main/runner/service.ts:627/694/825`); o commit do conflito usa `mergeMessage` sem número (`src/main/conflictGit.ts:331-340`, chamado de `src/main/actions.ts:848-853`); os merges de release têm mensagem própria e ficam fora do pedido (`src/main/releaseGit.ts:440/471/475`); esquema em v12 (`src/shared/config/types.ts:5`, `src/shared/config/migrations.ts:263`).
- Próxima etapa: refino do produto, que escreve a especificação a partir desta triagem e da issue; não há resposta esperada de ninguém.

# Memória do ciclo

## Decisões

- Os plugins são código próprio da equipe (não código de terceiro); a plataforma precisa primeiro aceitar plugins e trazer um SDK para desenvolvê-los.
- Tipo da issue: pedido de funcionalidade (plataforma nova). Não é bug, não é pergunta e não há duplicata.
- O contrato de extensão (hooks, eventos e ações) fica declaradamente para o refino e o plano, não para a triagem.
- Resposta: > **Aguardando resposta** > > ### A pergunta > Esta issue diz que "everything new in Coxia" e que outros itens dependem dela, mas não nomeia nenhum. Quais são os itens que dependem desta plataforma e o que cada um pede hoje; o que são "Prototypes", Clockify e Jira na sua cabeça de hoje e onde eles vivem; e, no seu caso, o plugin é código de terceiro que você instala e roda na sua máquina, ou código do próprio repositório ligado por configuração? os plugins devem ser codigo proprio que vamos construir mas primeiro precisa que o sistema aceite plugins e tenha sdk para o desenvolvimento deles <!-- answer:8 -->

## Restrições

- A plataforma é nova: não existe conceito de plugin sob `src/`, nenhum campo no `WorkspaceConfig` (`src/shared/config/types.ts:784-810`) e nenhum barramento de eventos de plugin (`AppEvent`, `src/shared/types.ts:444`, é canal de interface, não ponto de extensão).
- A fronteira de execução já existe e é fechada e é a que qualquer plugin teria de respeitar: sandbox por etapa com política pura de argumentos, sem rede por padrão e sem pasta pessoal (`src/main/sandbox/policy.ts`, `index.ts`); navegador pareado com listas fixas (`src/main/webPolicy.ts:11,21`).
- As integrações exemplificadas hoje entram como código do núcleo: o host de código só cresce por dentro do provedor neutro (`VcsProvider`, `src/main/vcs/types.ts:247-305`), com escritas descritas por `planWrite` e executadas por uma porta única (`src/main/actions.ts`; `VcsCommand` em `src/shared/types.ts:388`, ações em `:406`).
- Registros existentes são fechados (motores em `src/main/engine/registry.ts`; modelos de ciclo em `src/shared/cycles/index.ts`; provedores de código em `src/main/vcs/index.ts`); nenhum é um ponto genérico com manifesto para uma unidade nova entrar.

## Tentado e descartado

- Nada tentado em código. A verificação foi só leitura (issue, código desta árvore de trabalho, artefatos de ciclos anteriores); nenhum teste, gate ou execução do app.

## Perguntas abertas

- Quais são os "outros itens" que dependem desta plataforma e o que cada um pede hoje; a resposta da pessoa não os nomeou e continuam sem definição no repositório.
- O que são Prototypes, Clockify e Jira e onde vivem: só aparecem no texto da issue, sem descrição em nenhum documento do repositório.
- O que conta como tipo de artefato novo (aceitação: acrescentável sem tocar no núcleo) e o que significa, na prática, "um plugin não alcança outro espaço de trabalho sem permissão explícita".

## Onde o trabalho está

- Triagem concluída em `docs/cycles/[redacted]/0_TRIAGE.md`, com a resposta da pessoa incorporada. Próxima etapa: refino (spec funcional e plano técnico).

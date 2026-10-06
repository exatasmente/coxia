# Memória do ciclo

## Decisões

- Os plugins são código próprio da equipe (não código de terceiro); a plataforma precisa primeiro aceitar plugins e trazer um SDK para desenvolvê-los. Resposta da pessoa: "os plugins devem ser codigo proprio que vamos construir mas primeiro precisa que o sistema aceite plugins e tenha sdk para o desenvolvimento deles" <!-- answer:8 -->
- Tipo da issue: pedido de funcionalidade (plataforma nova). Não é bug, não é pergunta e não há duplicata.
- O contrato de extensão (hooks, eventos e ações) fica declaradamente para o refino e o plano, não para a triagem.
- Refino: a spec funcional está em `docs/cycles/[redacted]/1_SPEC.md`. Ela entrega três partes juntas — aceitar plugins, um kit de desenvolvimento no repositório e uma primeira entrega que prova as três pontas —, com as regras de declaração, fronteira, permissão, escrita externa pela porta única e rede só pela permissão listada (Regras 1 a 14).
- Primeira entrega decidida pela pessoa: "vamos construir um pugin para os agentes conseguirem fazer busca na WEB" <!-- answer:21 -->. A spec traduz isso em três pontas: um acontecimento que o app já publica, um tipo de documento novo com o resultado da busca e a fonte de onde veio, e uma escrita externa que espera o "sim".
- Escrita externa da primeira entrega: a pessoa aceitou a recomendação ("siga com a recomendação" <!-- answer:25 -->). Fica num destino neutro que o próprio plugin declara; o serviço de verdade é assunto do plugin de busca construído depois, em outra issue.
- Gate 1 (refino) aprovado pela pessoa <!-- comment:31 -->; a etapa seguinte é o plano.
- Plano concluído em `docs/cycles/[redacted]/2_PLAN.md`. Decisões de mecanismo fixadas: a seção `plugins` do `WorkspaceConfig` (esquema 13) guarda a pasta de plugins, a lista de ligados e as permissões; cada plugin é uma pasta com `plugin.json` lida e validada por uma função pura, sem carregador nativo; a lista é do espaço de trabalho e ligar/desligar vale no momento do uso, sem reinício e sem passar pelo navegador pareado; o catálogo de acontecimentos é fixo e público, separado do canal de interface (`AppEvent`); o script do plugin roda pela **mesma** abertura de sandbox da etapa (nenhuma política nova), sem autoridade do app e com a rede só pela lista; o pedido de escrita externa entra na mesma proposta da porta única de Ações (espera o "sim", recusa em espaço de trabalho de teste, auditoria); o tipo de documento novo soma-se à lista que o gate já percorre, sem tocar no leitor de hoje.

## Restrições

- A plataforma é nova: não existe conceito de plugin sob `src/`, nenhum campo no `WorkspaceConfig` (`src/shared/config/types.ts:784-810`) e nenhum barramento de eventos de plugin (`AppEvent`, `src/shared/types.ts:444`, é canal de interface, não ponto de extensão).
- A fronteira de execução já existe e é fechada e é a que qualquer plugin teria de respeitar: sandbox por etapa com política pura de argumentos, sem rede por padrão e sem pasta pessoal (`src/main/sandbox/policy.ts`, `index.ts`); navegador pareado com listas fixas (`src/main/webPolicy.ts:11,21`). A rede de um sandbox só sai por lista (`SANDBOX_NETWORKS`/`RunnerSandbox`, `src/shared/config/types.ts:687-715`; proxy de registro em `src/main/sandbox/proxy.ts`).
- As integrações exemplificadas hoje entram como código do núcleo: o host de código só cresce por dentro do provedor neutro (`VcsProvider`, `src/main/vcs/types.ts`), com escritas descritas por `planWrite` e executadas por uma porta única (`src/main/actions.ts`; `VcsCommand`/ações em `src/shared/types.ts:388,406`).
- Registros existentes são fechados (motores em `src/main/engine/registry.ts`; modelos de ciclo em `src/shared/cycles/index.ts`; provedores de código em `src/main/vcs/index.ts`); nenhum é um ponto genérico com manifesto.
- Os documentos do ciclo **não** são uma lista fechada de nomes: `readFolder`/`writeArtifact` aceitam o que passe `ARTIFACT_NAME` (`src/main/runner/cycleFolder.ts`, `src/shared/runs/output.ts:133`), e os gates leem a partir da configuração de ciclo (`gateOptions`, `src/main/gate.ts:102-109`). É a brecha que o tipo de documento novo usa.
- A configuração tem versão de esquema e migração degrau a degrau; uma mudança de configuração precisa do degrau em `STEPS` e dos três arquivos juntos (`types.ts`, `defaults.ts`, `schema.ts`), senão `test/config-schema.test.ts` falha.
- A aceitação da issue prende o desenho: instalar sem tocar no núcleo, não alcançar segredo nem dado de outro espaço de trabalho sem permissão explícita, e um tipo de documento novo acrescentável sem tocar no núcleo (o caso de teste da plataforma).
- Já existe uma leitura de web para os agentes de sistema (`WebFetch`, `WebSearch` em `src/main/agents.ts:406-407`), mas é ferramenta do agente, não ponto de extensão: a primeira entrega é o plugin da equipe, não essa ferramenta.
- O repositório é público: nada de nome de terceiro, host real, pessoa, número de issue real ou segredo na spec, no plano, no kit, nos exemplos ou nos testes.
- Toda string de interface passa por `t()` com a chave nos dois catálogos; tema usa tokens, nunca cor literal.

## Tentado e descartado

- Nada tentado em código até agora. A verificação foi só leitura (issue, respostas da pessoa, código desta árvore de trabalho, artefatos de ciclos anteriores); nenhum teste, gate ou execução do app em nenhuma etapa.
- Descartado fixar na spec um escopo mínimo com nome de terceiro: as integrações nomeadas na issue não aparecem descritas em nenhum documento do repositório além dela. Vale igual depois das respostas: a primeira entrega tem nome concreto ("busca na WEB para os agentes") e a escrita externa fica num destino neutro, sem serviço nomeado.
- Descartado, no plano, abrir uma sandbox própria para o plugin: duplicaria a fronteira em vez de reaproveitá-la. Descartado também fazer os hooks passarem pelo canal `AppEvent`, que é da interface.

## Perguntas abertas

- Quais são "os outros itens" que dependem desta plataforma e o que cada um pede hoje: a issue só diz que existem, as respostas não os nomearam e nada no repositório os define. Sem eles, o contrato nasce mínimo (Regras 6 a 8).
- O que este espaço de trabalho considera "permissão explícita" de um plugin ("does not reach secrets or another workspace's data without an explicit permission"): recomendação de partir fechado e tratar toda ampliação como permissão que só o computador concede.

## Onde o trabalho está

- Triagem, refino e plano concluídos em `docs/cycles/[redacted]/` (0_TRIAGE, 1_SPEC, 2_PLAN). Próxima etapa: implementação, seguindo a ordem de peças e o plano de teste do `2_PLAN.md`, sem reabrir a spec.
- O plano fixa: declaração e validação (função pura), seção `plugins` do `WorkspaceConfig` (esquema 13) com a lista e as permissões, catálogo fixo de acontecimentos, execução do script pela sandbox da etapa que já existe, escrita externa pela porta única de Ações, tipo de documento novo somado à lista que o gate já percorre, e o kit no repositório com o exemplo da primeira entrega. As duas perguntas abertas acima são da pessoa, não da implementação.
- Passagem plano → implementação: implementar as peças na ordem do plano e rodar os portões do repositório (tipos, suíte, auditoria de tema, lint de catálogos, auditoria pública) antes de fechar.
- Passagem support → product-owner: Ler a issue 84 com a resposta da pessoa já registrada e escrever a spec funcional e o plano técnico. Pontos que o refino precisa fechar, sem reabrir o que a resposta já decidiu: (a) os plugins são código próprio da equipe e a plataforma precisa aceitar plugins e vir com um SDK — o desenho da fronteira não é mais sobre código de terceiro; (b) os \"outros itens\" dependentes não foram nomeados e continuam sem definição no repositório; (c) Prototypes, Clockify e Jira não têm escopo descrito em lugar nenhum além do texto da issue, então o exemplo de primeira entrega (\"um artefato novo mais uma in… <!-- handoff:10 -->
- Passagem product-owner → pessoa: Elaborar o plano técnico da plataforma de plugins sobre a spec fechada: onde a declaração de um plugin vive e como é lida e validada; como o catálogo de acontecimentos (Regra 6) é publicado no kit e assinado; como um tipo de documento novo entra no SpecLayout/GateFiles sem tocar no código que lê os tipos atuais; como o pedido de escrita externa de um plugin entra na porta única de Ações; e como o código do plugin roda dentro da fronteira que já existe (sandbox por etapa, sem rede por padrão, rede só por lista). A escrita externa da primeira entrega é um destino neutro declarado pelo próprio pl… <!-- handoff:28 -->

# Memória do ciclo

## Decisões

- Refino de 82 (tentativa 1): `1_SPEC.md` entregue; nenhuma pergunta — os cinco pontos que a triagem deixou para o refino foram fixados nas Regras 1 a 6 da spec.
- Nome e lugar: `REQUIREMENTS.md`, `PROTOTYPE.md`, `USER_MANUAL.md`, na raiz da pasta do ciclo, ao lado dos documentos de sempre.
- Ciclo de agentes: requisitos no refinamento (lido pelo portão 1), protótipo no plano (portão 2), manual na etapa final (depois do último portão, ao lado da nota de lançamento).
- Plugin embutido vem declarativo e ligado por padrão; desligado na lista de plugins, os três tipos deixam de ser lidos (fase e portões), sem reiniciar.
- Fase: os três documentos do fluxo contam (cada um representa seu ponto do fluxo); documento colateral de plugin (busca) não move a fase — regra fixada.
- Prioridade proposta: `priority:low` (a da issue): capacidade nova, sem defeito nem bloqueio; sobe a medium se alguém esperar o manual. Marco: nenhum (o registro de 82, 84 e 97 não traz marco).

## Restrições

- Só leitura nesta etapa: nada foi executado (nenhum teste, nenhum aplicativo); a comprovação das leituras está em ev-1 e a spec marca cada ponto como lido, não executado.
- Fora de escopo, ditos pela issue: protótipo em alta fidelidade; layout dos artefatos é do refino e do plano. Fora do refino: formato/conteúdo dos três documentos (é do fluxo) e todo o mecanismo de leitura é do plano.
- Execuções em andamento continuam no fluxo com que começaram; o fluxo é dado do espaço de trabalho e a pessoa pode editar (tirar um dos documentos ou o manual de ciclos que não o quiserem).

## Tentado e descartado

- Perguntar à pessoa nomes, etapas, lugar do manual e estado inicial do plugin — descartado: a issue diz que o layout é "for refinement and planning", então o refino decide e o gate 1 aprova.
- Pôr requisitos e protótipo juntos no refinamento, ou o manual no QA/revisão — descartado: um documento por etapa anterior a um portão deixa cada portão com o seu e a fase com progressão legível (requisitos → protótipo → manual).
- Procurar marco no host (issues 82, 84, 97): nenhum tem — proposta de marco nula.

## Perguntas abertas

Nenhuma que pause a etapa. Fica para o plano (tech-lead): o mecanismo que entrega as regras sem mudar os leitores — como a fase encontra os tipos novos, como cada portão escolhe o seu documento (hoje o portão 1 não os vê e `find` pega o primeiro), o default do plugin para espaços existentes, rótulos e fases nos dois catálogos, e os testes.

## Onde o trabalho está

- `1_SPEC.md` entregue nesta tentativa na pasta do ciclo; issue, memória e triagem continuam como estavam.
- Confirmado por leitura (não executado): fase só lê `phaseFiles` (`src/main/cards.ts:28-40`); portão soma documentos de plugin só no segundo, fixo (`src/main/gate.ts:110-125`, registro `src/main/plugins/module.ts:665`); portão escolhe a primeira opção do número (`:175`); plugin sem escolha fica desligado (`src/main/plugins/read.ts:111`); declaração sem `entry` é válida (`src/shared/plugins/declaration.ts:76,197-203`); único plugin embutido é busca web com um documento; `rules/` não existe na árvore; etapa sem seus documentos é reparada uma vez (`prompt.sdd.runner.repair.missingArtifacts`, `flowCheck.ts:97-101`).
- Próxima etapa: plano (tech-lead).
- Passagem: escrever o plano a partir da spec — leitura da fase e dos portões para os três tipos, produção em refine/plan/communicate, plugin embutido ligado por padrão com migração, i18n e testes; distinção entre documentos do fluxo e colaterais é decisão técnica. <!-- handoff:35 -->
- Passagem support → product-owner: Seguir para o refino: fixar os nomes e os lugares dos documentos de requisitos, protótipo e manual, em qual etapa cada um entra e é lido, onde o manual aparece, se o plugin embutido vem ligado por padrão e se os documentos de plugin também movem a fase. A-base da plataforma foi conferida por leitura, não executada. <!-- handoff:34 -->

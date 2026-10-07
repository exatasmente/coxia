# Memória do ciclo

## Decisões

- Triagem da #142: **bug**, confirmada por leitura de código. Sem pergunta ao repórter; o que a issue deixava em aberto era decisão de projeto.
- Refinamento: a spec está em `1_SPEC.md`. As três decisões de projeto que ela fecha: (1) **uma rodada de reparo** por etapa de QA com sandbox, para os cenários afirmados como executados e sem respaldo, com as saídas guardar-a-comprovação-e-apontar-o-comando, apontar-o-comando, assumir-lido ou assumir-não-rodado, e o rebaixamento só depois dela, com linha na conversa; (2) **o registro manda no que se publica** — os cenários gravados depois da rodada alimentam de uma só vez o registro da execução, o `5_TEST_PLAN.md` e o comentário; (3) **a imagem olhada e não guardada é guardada automaticamente no fecho**, e o que não puder ser guardado é dito como visto-não-guardado, com o motivo.
- **Um cenário rebaixado não reprova a etapa nem vira pendência**; a severidade do cenário continua sendo o único gatilho de devolução. Etapa de QA sem sandbox fica como hoje.
- Prioridade proposta: a mais alta dos níveis configurados (a issue veio com `priority:high`). Nenhum marco proposto.
- **Plano (`2_PLAN.md`)**, com os quatro pontos que a spec deixou fechados: (a) a rodada de reparo cabe dentro do `try` de `runStage`, com a sandbox aberta, o que **obriga a adiar o fecho da sessão** — hoje ele fecha antes de o app ler a resposta (`executor.ts:721-735`, leitura na 737); as duas chamadas ao motor correm dentro do mesmo trabalho vigiado pelo `watchdog`, para o teto de relógio não valer duas vezes. (b) O app sabe qual imagem foi olhada por um gancho em `lookAtImage` (`sandbox/tool.ts:115-125`), único ponto por onde as duas engines veem imagem (lido `sandbox/engineTool.ts` e `agents.ts:501-505`); reconhecimento por conteúdo foi descartado. (c) Fonte única: `output.scenarios` calculado uma vez e o mesmo vetor dado a `recordQa`, ao `5_TEST_PLAN.md` (reescrito por função pura antes do `tidyArtifact`) e ao comentário. (d) Chaves de catálogo novas nas duas famílias (`prompt.sdd.runner.repair.unbacked`, `main.forum.code.runner.qa.repair`, `...qa.unbacked`, `...qa.lookNotKept`, `...qa.lookKept`, `main.evidence.keptByApp`).

## Restrições

- Achados por **leitura de código**, não por execução: nada foi rodado, nenhuma tela aberta, nenhum run reproduzido. A execução real citada pela issue não foi refeita nem conferida.
- A guarda automática não pode ler caminho fora da pasta de saída da etapa; o tipo continua sendo lido do conteúdo e o teto de tamanho continua valendo.
- O que já foi publicado no host não é apagado nem mudado. Nada de fora do escopo da spec.
- A conferência pública: sem nome real, host, número de issue ou credencial em código, teste, mensagem de commit ou nome de ramo.

## Tentado e descartado

- Perguntar ao repórter: descartado na triagem.
- Duplicata da #121 ou da #120: descartado; a #121 entregou a ferramenta e o `ViewImage`.
- Fazer o rebaixamento reprovar a etapa: descartado.
- Só listar "visto, não guardado" em vez de guardar: descartado, com o motivo na spec.
- Reconhecer a imagem olhada pelo conteúdo (varredura da pasta de saída): descartado no plano; guardaria imagem que ninguém olhou e não separa repetida de nova.
- Abrir pergunta à pessoa: descartado; as escolhas de projeto são do produto e a spec as faz com justificativa.

## Perguntas abertas

- **Não verificado, a confirmar no desenvolvimento:** se a segunda chamada cabe no `guard` sem contar o teto duas vezes e com o fecho da sandbox ainda garantido no caminho de falha; se o gancho em `lookAtImage` cobre todos os caminhos de imagem das duas engines; se o cabeçalho normalizado do documento engole uma lista de cenários logo abaixo do título; se as chaves de catálogo novas bastam para a conferência.
- Se a guarda automática se revelar impossível, a saída aceitável é a outra opção da issue (dizer na conversa o que foi olhado e não guardado), nunca deixar sumir em silêncio — dizer na entrega.

## Onde o trabalho está

- Triagem, refinamento e plano concluídos; `0_TRIAGE.md`, `1_SPEC.md` e `2_PLAN.md` na pasta do ciclo. Nenhum código tocado: o campo de commit desta etapa vai vazio.
- O que foi conferido por leitura no plano: o fecho da sandbox está no `finally` de `runStage` antes da leitura da resposta (`executor.ts:721-735,737`); a `ViewImage` das duas engines passa por `lookAtImage`; `backEvidence` rebaixa e marca sem respaldo (`src/shared/runs/output.ts:204-214`, chamada em `executor.ts:752`); o plano de teste é gravado como o agente o escreveu (`executor.ts:765`, `cycleFolder.ts:113-134,137-145`); ver imagem não guarda (`evidence/handlers.ts:145-155`); a pasta da etapa some com a sandbox (`sandbox/session.ts:214`); `recordQa` e o comentário leem o mesmo objeto da resposta (`service.ts:643-708`, `publish.ts:574-597`, `comment.ts:56-78`); os testes de catálogo conferem as chaves nos dois idiomas (`test/i18n.test.ts:61-87`).
- **Regra `.coxia` a corrigir na entrega:** `.coxia/rules/runner.md:65-67` afirma que o app não confere se a afirmação de um agente é verdadeira — falso já hoje no caso estreito do respaldo de um cenário de QA, e mais falso com a rodada de reparo. Lida no arquivo; é corrigida nesta mesma mudança. Outras duas correções de passagem anotadas: um erro de digitação no comentário sobre a classificação de um comando, e um teto divergente no comentário do módulo de comprovação.
- Não verificado: nada foi exercitado; e tudo o que o plano marca como não verificado (o lugar da segunda chamada no `guard` e o fecho adiado, o gancho da imagem, o cabeçalho do documento, as chaves de catálogo).
- Passagem plan → implement: usar `2_PLAN.md`, seções "Decisões de desenho" e "Ordem de implementação"; implementar em cinco passos com teste cada, seguindo `test/runner-evidence.test.ts` e `test/runs-scenario.test.ts`, e resolver os pontos não verificados com teste.
- Passagem support → product-owner: Refinamento do produto: transformar a correção em spec funcional a partir de 0_TRIAGE.md. O que a spec precisa fixar: (1) a rodada de reparo de um cenário `executed` sem comando e sem id de comprovação — quando ela acontece, o que se pede ao agente e o que ele pode responder (guardar a comprovação, citar comandos, ou virar `read`/`not-run`), e que o rebaixamento automático só ocorra depois dela, com linha na conversa; (2) o que o `5_TEST_PLAN.md` e o comentário de QA passam a dizer quando divergem do registro — qual é a fonte da verdade (os cenários gravados depois de `backEvidence`) e como um… <!-- handoff:7 -->
- Passagem product-owner → pessoa: Plano técnico (tech-lead) a partir de 1_SPEC.md. O que a spec fixa e o plano precisa resolver: (a) ONDE cabe a rodada de reparo — uma segunda chamada ao mesmo agente, dentro da etapa, entre a resposta e o fecho da sandbox, com o mesmo conjunto de ferramentas e sem virar etapa nova; hoje a sandbox é fechada quando a etapa termina (src/main/runner/executor.ts:434-439 e 727-735), e o reparo de formato que existe morre dentro do loop do motor aberto (src/main/engine/open/loop.ts:460-462,543-549). Ler o ciclo de vida da chamada nos dois motores e o que os dois tetos de tempo da etapa contam. (b) O … <!-- handoff:34 -->

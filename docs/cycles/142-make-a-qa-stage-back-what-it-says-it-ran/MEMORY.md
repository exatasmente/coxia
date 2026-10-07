# Memória do ciclo

## Decisões

- Triagem da #142: **bug**, confirmada por leitura de código. Sem pergunta ao repórter; o que a issue deixava em aberto era decisão de projeto.
- Refinamento: a spec está em `1_SPEC.md`. As três decisões de projeto que ela fecha:
  1. **Uma rodada de reparo** por etapa de QA com sandbox, para os cenários afirmados como executados e sem respaldo: uma segunda chamada ao mesmo agente, dentro da mesma etapa e da mesma sandbox, antes do fecho, com as saídas guardar-a-comprovação-e-apontar-o-comando, apontar-o-comando, assumir-lido ou assumir-não-rodado. O rebaixamento só depois dela, com linha na conversa, e a etapa não gira (uma rodada, não duas).
  2. **O registro manda no que se publica:** os cenários gravados depois da rodada e das conferências alimentam de uma só vez o registro da execução, o `5_TEST_PLAN.md` e o comentário; citar comprovação nunca faz um cenário valer como executado.
  3. **A imagem olhada e não guardada é guardada automaticamente no fecho da etapa**, antes de a pasta da etapa sumir; o que não puder ser guardado é dito como visto-não-guardado, com o motivo. Justificativa: a outra opção perde exatamente o que a issue relata (o que o agente olhou some e o cenário fica sem comprovação).
- **Um cenário rebaixado não reprova a etapa nem vira pendência:** a severidade do cenário continua sendo o único gatilho de devolução. Respondida a pendência que a triagem deixou.
- Etapa de QA sem sandbox fica como hoje: todo cenário lido, nenhuma rodada extra.
- Prioridade proposta: a mais alta dos níveis configurados (a issue veio com `priority:high`). Nenhum marco proposto: esta etapa não leu a lista de marcos do host e a mudança é correção de comportamento, sem capacidade nem configuração nova.

## Restrições

- Achados desta etapa são por **leitura de código**, não por execução: nada foi rodado, nenhuma tela aberta, nenhum run reproduzido. A execução real citada pela issue não foi refeita nem conferida.
- A guarda automática não pode ler caminho fora da pasta de saída da etapa; o tipo continua sendo lido do conteúdo e o teto de tamanho continua valendo.
- O que já foi publicado no host não é apagado nem mudado.

## Tentado e descartado

- Perguntar ao repórter: descartado na triagem; a issue tem comportamento, esperado, critério e pontos no código.
- Tratar a #142 como duplicata da #121 ou da #120: descartado; a #121 entregou a ferramenta e o `ViewImage`, esta cobra o comportamento em volta deles.
- Fazer o rebaixamento reprovar a etapa: descartado; mudaria o que a etapa significa e poderia travar uma entrega por um erro de anotação no fim do run.
- Só listar "visto, não guardado" em vez de guardar (a segunda opção que a issue oferecia): descartado, com o motivo escrito na spec.
- Abrir pergunta à pessoa nesta etapa: descartado; as duas escolhas de projeto são do produto e a spec as faz com justificativa.

## Perguntas abertas

- **Como o app sabe qual imagem o agente olhou** (para a guarda do fecho): por um registro que a ferramenta deixe, ou pelo conteúdo. Está na spec como ponto a confirmar no plano; se a guarda automática se revelar impossível, a saída aceitável é a outra opção da issue (dizer na conversa o que foi olhado e não guardado), nunca deixar sumir em silêncio.
- Fica para o plano: onde a segunda chamada cabe no ciclo de vida da sandbox da etapa, nos dois motores, e o que os dois tetos de tempo contam.
- Fica para o plano: o cabeçalho normalizado de um documento de etapa pode engolir uma lista de cenários escrita logo abaixo do título.
- Fica para o plano: as chaves de catálogo novas e se algum teste de catálogo trava a lista.

## Onde o trabalho está

- Triagem e refinamento concluídos; `0_TRIAGE.md` e `1_SPEC.md` na pasta do ciclo. Nenhum código tocado: o campo de commit do refinamento vai vazio.
- O que a spec conferiu por leitura: `backEvidence` (`src/shared/runs/output.ts:204-214`) rebaixa e marca sem respaldo, chamado em `src/main/runner/executor.ts:747-752`, sem avisar o agente nem escrever na conversa; o reparo de hoje é só de formato e só no motor aberto (`src/main/engine/open/loop.ts:460-462,543-549`); o plano de teste e o comentário saem do texto do agente (`executor.ts:758-767`, `src/shared/runs/comment.ts:56-78`, `src/main/runner/publish.ts:574-597`); ver imagem não guarda (`src/main/evidence/handlers.ts:145-155`) e guardar é chamada separada com tipo pelo conteúdo; a pasta da etapa some com a sandbox (`src/main/sandbox/session.ts:214`); os testes atuais cobrem só o rebaixamento (`test/runs-scenario.test.ts:126-144`).
- Correções de leitura anotadas na spec: o trecho 82-119 do arquivo compartilhado é a descrição que acompanha o esquema, e o trecho 204-214 que a triagem cita como leitura da resposta é outro caminho (a leitura de comentário e da descrição do pull request, 222-237).
- Regra da pasta `.coxia` corrigida nesta mudança: `.coxia/rules/development-cycles.md` afirmava que a resposta de uma etapa não é verificada pelo app — falso no caso estreito da conferência do respaldo de um cenário de QA. A regra agora diz que o app confere o respaldo contra os comandos da etapa e marca quem não tem respaldo, e que ele não julga a verdade do texto.
- Não verificado: nada foi exercitado; e tudo o que a spec marca como "não verificado" (o ciclo de vida da sandbox para a segunda chamada, o registro da imagem olhada, o cabeçalho do documento, as chaves de catálogo).
- Passagem refine -> plan: usar `1_SPEC.md` (seções de regras 1 a 4 e "Para quem programa") para o plano técnico, resolvendo os pontos acima.
- Passagem support → product-owner: Refinamento do produto: transformar a correção em spec funcional a partir de 0_TRIAGE.md. O que a spec precisa fixar: (1) a rodada de reparo de um cenário `executed` sem comando e sem id de comprovação — quando ela acontece, o que se pede ao agente e o que ele pode responder (guardar a comprovação, citar comandos, ou virar `read`/`not-run`), e que o rebaixamento automático só ocorra depois dela, com linha na conversa; (2) o que o `5_TEST_PLAN.md` e o comentário de QA passam a dizer quando divergem do registro — qual é a fonte da verdade (os cenários gravados depois de `backEvidence`) e como um… <!-- handoff:7 -->

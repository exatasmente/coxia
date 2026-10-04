# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (rótulo `enhancement`); não é bug, não é pergunta e não repete outra issue. Nada é aplicado em silêncio: aceitar cria um agente comum e editável depois.
- A resposta de quem abriu fechou as quatro decisões:
  - **De onde a sugestão nasce.** Do histórico que o app já grava, sem gravar nada novo na primeira versão: das execuções (perguntas `needs-person` sobre o mesmo tema em execuções diferentes; devoluções repetidas para a mesma etapa pelo mesmo motivo; rodadas de revisão e cenários de QA que repetem o tipo de achado; etapas que a pessoa assume à mão — pula, refaz ou responde no lugar do agente), dos comandos permitidos (o mesmo comando aprovado de novo e de novo) e das cerimônias (as decisões e atas, e as melhorias que a retro levanta). A transcrição completa das cerimônias fica para depois; toda sugestão cita a evidência com link e, sem evidência, não há sugestão.
  - **Onde a decisão fica registrada.** Nos dados do workspace, nunca no repositório (público): um registro por sugestão com o proposto (papel, etapa, prompt), a evidência, a decisão, quem decidiu e quando, sem prazo. A recusa guarda a "impressão" (papel + etapa + tipo de evidência); a mesma impressão só volta com evidência nova que a recusa não viu, e a proposta diz que foi recusada antes, quando e o que mudou. O aceite fica registrado junto do agente que criou.
  - **Onde a proposta aparece.** Como uma proposta em Ações, com nome, papel, etapa, rascunho do prompt, permissões propostas (o mínimo: somente leitura, sem comandos) e a evidência com links à vista. Aceitar cria um agente comum editável; editar abre o editor de agente em Configurações › Time já preenchido (salvar cria o agente); recusar pede motivo opcional, que fica no registro.
  - **Quando é oferecida.** A pedido (botão "Sugerir agentes" em Configurações › Time) e, por conta própria, só no fim da retro, no máximo duas sugestões e só com evidência que passou do limiar e não bate com uma recusa. Nunca no meio de uma execução nem de uma cerimônia.
- Resposta: ### Resposta **1. De onde a sugestão nasce.** Do histórico que o app já grava, sem gravar nada novo na primeira versão: - das **execuções**: perguntas que chegam à pessoa (`needs-person`) sobre o mesmo tema em execuções diferentes, devoluções repetidas para a mesma etapa pelo mesmo motivo, rodadas de revisão e cenários de QA que voltam com o mesmo tipo de achado, e etapas que a pessoa assume à mão (pula, refaz ou responde no lugar do agente); - dos **comandos permitidos**: o mesmo comando que a pessoa permite de novo e de novo é um passo manual repetido; - das **cerimônias**: as decisões e ata… <!-- answer:24 -->

## Restrições

- O repositório é público: nada de nome de empresa, pessoa, host ou número de issue real em código, teste, fixture ou doc. O registro da decisão e a evidência vivem nos dados do workspace, nunca no repositório.
- Leitura só: a triagem não altera arquivos nem executa comandos. Todo comportamento citado sem execução é "não verificado".
- Nada de permissão acima do mínimo na sugestão: a proposta nasce somente leitura e sem comandos, e nunca é aplicada sem o "sim".
- Não decidir prioridade nesta issue, nem projetar a solução na triagem; a spec e o plano são da etapa seguinte.
- A etapa da resposta deixou a transcrição completa das cerimônias explicitamente para depois; a v1 não pode depender dela.

## Tentado e descartado

- A triagem anterior fez quatro perguntas a quem abriu (fonte do histórico, onde a decisão é registrada, onde a proposta aparece, quando é oferecida); todas foram respondidas e reescritas na resposta, e o documento de triagem foi atualizado com ela em vez de reabrir a leitura do repositório.
- Descartado tratar \"duração de etapa\" como fonte: a resposta trocou isso por \"etapas que a pessoa assume à mão\" e pelo histórico por execução.
- Descartado voltar a perguntar: nenhuma questão de produto ficou aberta.

## Perguntas abertas

- Nenhuma de produto. O refino precisa fechar duas de desenho técnico: onde encaixa a etapa que o agente novo cobriria (o ciclo é dado do workspace, `devCycle.stages`; hoje só existe `runs:migrateFlow`, que mexe no fluxo de uma execução) e por onde se lê a evidência de \"comando permitido de novo e de novo\" (o pedido de comando só vive enquanto a etapa vive; o que sobra é a linha de auditoria, `src/main/runner/service.ts:271-309`).

## Onde o trabalho está

- `docs/cycles/[redacted]/` com `0_ISSUE.md`, `0_TRIAGE.md` (atualizado com a resposta) e esta memória.
- Triagem concluída; a próxima etapa é o refino (spec funcional + plano técnico). Nada foi implementado nem commitado por esta etapa.

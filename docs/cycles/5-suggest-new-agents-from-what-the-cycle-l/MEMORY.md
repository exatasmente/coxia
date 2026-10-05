# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (`enhancement`). Nada é aplicado em silêncio: aceitar cria um agente comum e editável depois.
- A resposta de quem abriu fechou as quatro decisões de produto e o refino fechou o resto na spec `1_SPEC.md`: a fonte é o histórico já gravado (execuções, comandos permitidos, decisões/atas), sem gravar nada novo na v1 (transcrição das cerimônias fica para depois); o registro fica nos dados do workspace, por sugestão, sem prazo, com proposta + evidência + decisão + quem + quando, e a recusa guarda a impressão (papel + etapa + tipo de evidência); a proposta aparece em Ações com nome, papel, etapa, rascunho de prompt, permissões no mínimo e evidência com links, com os três caminhos (aceitar cria agente comum; editar abre o editor em Configurações › Time preenchido; recusar pede motivo opcional); e é oferecida a pedido (botão "Sugerir agentes" em Configurações › Time) e no fim da retro (no máximo duas).
- Prioridade **normal** e marco **próximo ciclo de aprendizado** propostos; a pessoa decide.
- O plano técnico (`2_PLAN.md`) fechou os dois pontos de desenho abertos e as demais escolhas:
  - A etapa que o agente cobriria é **sempre existente** (`devCycle.stages`/`flows`), por id; **nenhum caminho novo de fluxo** e `runs:migrateFlow` não é tocado.
  - A fonte "comando permitido de novo e de novo" lê a linha de auditoria (`auditoria.jsonl`, `kind: 'exec'`); sem linha, nenhum achado; nada de história nova (o `PendingCommand` não é gravado).
  - O registro da decisão vai num arquivo próprio do workspace, `suggestions.json`, irmão de `acoes.json` — **não** na configuração, então **não** exige passo em `STEPS` nem o trio `types.ts`/`defaults.ts`/`schema.ts`.
  - A proposta é um tipo de ação novo (`kind: 'suggest-agent'`) com função própria `proposeAgentSuggestion`, **não** `proposeVcsAction` (que exige `VcsCommand` e valida escrita no host); o cartão comum de Ações mostra nome/papel/etapa/rascunho/permissões/evidência no `output`.
  - Aceitar cria o agente direto (`addAgent`+`newAgent`, permissões no mínimo) e **não** abre o editor; editar é o outro caminho.
  - O gancho do fim da retro herda só a forma da #16 (proposta em Ações no fim da retro), não o conteúdo.
- Resposta: ### Resposta **1. De onde a sugestão nasce.** Do histórico que o app já grava, sem gravar nada novo na primeira versão: - das **execuções**: perguntas que chegam à pessoa (`needs-person`) sobre o mesmo tema em execuções diferentes, devoluções repetidas para a mesma etapa pelo mesmo motivo, rodadas de revisão e cenários de QA que voltam com o mesmo tipo de achado, e etapas que a pessoa assume à mão (pula, refaz ou responde no lugar do agente); - dos **comandos permitidos**: o mesmo comando que a pessoa permite de novo e de novo é um passo manual repetido; - das **cerimônias**: as decisões e ata… <!-- answer:24 -->

## Restrições

- Repositório público: nada de empresa, pessoa, host ou número de issue real em código, teste, fixture ou doc. O registro e a evidência vivem nos dados do workspace, nunca no repositório.
- Sugestão nasce somente leitura e sem comandos; nada acima do mínimo; nada aplicado sem o "sim".
- A v1 não grava história nova nem lê a transcrição das cerimônias.
- Não misturar com a #16 (da #16 só a forma "proposta em Ações" e o gancho do fim da retro) nem com a #8.
- Toda string de interface por `t()` nos dois catálogos; tema por tokens.
- Canais de decisão da sugestão são desktop-only (como `config:save`); um navegador pareado não cria agente.

## Tentado e descartado

- Descartado tratar "duração de etapa" como fonte; descartado voltar a perguntar a quem abriu.
- Descartado reusar `proposeVcsAction`: exigiria um `VcsCommand` falso e passaria pela validação de escrita externa, que a sugestão não faz.
- Descartado gravar o registro na configuração: seria dado do workspace, não config, e arrastaria migração de schema.
- Descartado criar/alterar etapas do fluxo a partir da sugestão; descartado sugerir permissões acima do mínimo; descartado oferecer sugestão no meio de execução/cerimônia.

## Perguntas abertas

- Nenhuma de produto nem de desenho. Restam detalhes de implementação, não perguntas: o valor final do limiar, se o cartão usa `stage` como subtítulo ou nada, e o id do agente derivado do nome com desambiguação. Nenhuma pausa.

## Onde o trabalho está

- `docs/cycles/[redacted]/` com `0_ISSUE.md`, `0_TRIAGE.md`, `1_SPEC.md` e `2_PLAN.md` (esta etapa). Nada foi implementado, executado ou commitado.
- Plano concluído: fecha as fontes, o registro, a proposta em Ações, a etapa existente, o botão e o gancho da retro, com testes e gates. A próxima etapa é a implementação, em três commits (seção 5 do plano), depois revisão e teste.
- Tudo o que o plano afirma foi lido no código desta árvore (nada foi executado); comportamento de modelo, volume real do histórico, o limiar e a renderização do cartão ficam não verificados.
- Passagem support → product-owner: Refinar a sugestão de agentes novos a partir da resposta de quem abriu: a spec funcional e o plano técnico precisam fechar (1) de que histórico a sugestão é derivada, com as fontes apontadas — perguntas `needs-person` do mesmo tema entre execuções, devoluções repetidas para a mesma etapa pelo mesmo motivo, rodadas de revisão e cenários de QA que repetem o tipo de achado, etapas que a pessoa assume à mão, o mesmo comando aprovado repetidas vezes e as decisões/atas das cerimônias —, lendo só o que o app já grava (run JSON, `historico/`, atas) e sem gravar nada novo na v1; (2) como a sugestão cit… <!-- handoff:27 -->
- Passagem product-owner → pessoa: Escrever o plano técnico (2_PLAN.md) sobre a spec funcional pronta, fechando os dois pontos de desenho que ficaram abertos e conferindo cada um no código desta árvore: (1) de onde a sugestão é derivada, ligando cada fonte às estruturas que o app já grava — perguntas `needs-person` e a cadeia de agentes no run JSON, `returns`/`roundLimit` (devoluções para a mesma etapa pelo mesmo motivo), `reviews`/`qa` (rodadas e cenários repetidos), as etapas assumidas à mão (pula/refaz/responde no lugar do agente) no histórico tipado, a linha de auditoria de comando permitido (`src/main/runner/service.ts:271… <!-- handoff:34 -->

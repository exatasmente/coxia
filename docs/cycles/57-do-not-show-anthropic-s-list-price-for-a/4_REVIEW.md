# A revisão da mudança que tira o preço de lista da Anthropic da etapa

## O que foi conferido

A revisão leu o código da mudança e o confrontou com a especificação, o plano e a fronteira de segurança, e rodou as validações do repositório nesta cópia do código. Nada foi dado como feito sem ter sido lido ou exercitado.

- `npx tsc --noEmit` passou (sem erros).
- `node scripts/theme-audit.mjs` passou, sem novas cores literais (as 8 do `api.ts` já existiam).
- `npm run i18n:lint` passou, com a chave nova nos dois idiomas (4055 chaves em cada catálogo).
- `node scripts/public-audit.mjs` passou (910 arquivos, nada de empresa, host, pessoa ou número de issue real).
- A suíte de testes foi rodada inteira. Ela teve 21 falhas, todas por estouro de tempo em arquivos que dependem de git (`conflict-*`, `release-git`, `updates-source`, `runner-chain`, `runner-release`, `host-terms-leak`). Rodados isoladamente, esses mesmos arquivos passam, e o conteúdo deles não toca custo de etapa, SDK, uso ou tela. As falhas são do ambiente desta cópia, não da mudança. Os cinco arquivos de teste que a mudança toca — `test/runs-usage.test.ts`, `test/run-view.test.ts`, `test/runner-agent.test.ts`, `test/runner-lifecycle.test.ts` e o de deriva do esquema — passaram (117 testes).

## O que a mudança faz, pelo código lido

- `src/main/agents.ts`: a função `isAnthropicApi` decide pelo alvo resolvido da chamada; só `kind === 'anthropic'` com endereço igual a `https://api.anthropic.com` trata `total_cost_usd` como custo cobrado. Todo o resto emite o mesmo valor com `costEstimated: true`. O teste do endereço é o mesmo regex que o runtime já usa, e não uma comparação nova.
- `src/shared/runs/usage.ts`: o contrato de uso e o total da etapa ganharam `costEstimated`, separado do `estimated`, que continua falando só de tokens. A função `provenance` aplica a regra fixada: um valor cobrado, em qualquer lado, torna a etapa cobrada; a etapa é estimada só quando há custo e nenhum valor cobrado entrou; um lado sem custo é neutro.
- `src/shared/runs/types.ts` e `schema.ts`: o campo é opcional no registro e no esquema. `RUN_VERSION` não mudou e não há passo em `STEPS`; `src/main/runner/service.ts` e `transitions.ts` não mudaram de forma.
- `src/shared/runs/view.ts` e `StageTimeline.tsx`: `usageParams` devolve `estimated` a partir de `costEstimated`, e a tela escolhe entre a frase de valor cobrado, a de estimativa e a de uso sem custo. A chave nova existe nos dois catálogos.
- A fronteira de segurança não foi tocada: nada novo escreve no host de código, nenhum caminho novo fora das Ações, nenhuma mudança de configuração. A auditoria pública confirma que nada sensível entrou.

## Confronto com a especificação

- **Critério 1** (fora da API própria, o preço de lista não aparece como custo da etapa): atendido, e coberto por teste para endereço próprio, Bedrock, Vertex e Foundry.
- **Critério 2** (provedor informa o custo → mostra o valor): atendido no motor aberto e na API própria.
- **Critério 4** (API própria → valor do SDK como cobrado): atendido e coberto por teste.
- **Critério 5** (motor aberto com custo informado continua cobrado): atendido; o motor aberto não mudou.
- **Critério 7** (tokens iguais aos de antes): atendido; a soma de tokens não mudou.
- **Critério 8** (a frase deixa de afirmar que todo valor presente foi informado pelo provedor): atendido; a chave antiga deixou de ser usada para todo valor presente e há uma frase própria de estimativa.
- **Critério 9** (documentação ajustada): atendido em `docs/llm-providers.md` (pt e en), `docs/runner.md` (pt e en) e `CHANGELOG.md`.
- **Critério 10** (nenhum teste alcança modelo/host/rede): atendido; os testes usam o SDK simulado e os motores falsos.
- **Critério 3** (quando o provedor não informa o custo, a tela mostra um valor marcado como estimativa, nunca vazio): não coberto. A implementação só relabela um custo que já veio; quando o resultado do SDK não traz `total_cost_usd`, nenhum relatório de uso é emitido e a etapa fica sem custo. Não há teste para um resultado do SDK sem esse campo. Pelos tipos do SDK, `total_cost_usd` é obrigatório, então o caso pode ser inalcançável na prática — o que, se confirmado, torna o critério 3 inaplicável em vez de descumprido. Fica registrado como sugestão, não como bloqueio, porque o comportamento medido da issue não depende desse caso.
- **Critério 6** (as duas origens de estimativa se distinguem pelo texto): a marca de tokens estimados continua sendo descartada por `addReport` e nunca chega à tela, então a distinção se apoia na ausência de qualquer texto para esse caso, não num texto próprio. É o mesmo comportamento de antes da mudança, registrado como observação.

## Lacunas e observações

- A origem do preço da estimativa segue não decidida, como a especificação e o plano já declaravam. Enquanto isso, o número marcado como estimativa é o preço de lista da Anthropic para um modelo Claude — o mesmo valor que a issue mediu como cerca de 30 vezes o cobrado. A marca corrige a honestidade da exibição, não a magnitude do número. É a pergunta em aberto registrada desde a especificação.
- O comportamento numa execução real contra um provedor que não seja a API própria da Anthropic não foi verificado: nenhum modelo de verdade, host real ou rede foi alcançado.
- A execução já gravada continua abrindo: o campo é opcional, e um registro sem ele é lido como cobrado. Há teste de leitura para os dois formatos.

## Veredito

Aprovada com sugestões. A mudança cumpre o escopo acordado, roda dentro dos gates do repositório e não abre caminho novo de escrita fora das Ações. As sugestões tratam de cobertura de teste e de um critério cujo caso pode ser inalcançável, não de um defeito no comportamento entregue.

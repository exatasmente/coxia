# A atribuição por responsável aparece onde o gatilho é configurado e lido, e nada mais mudou

## Veredito

Aprovado. Os seis trechos de texto estão no estado final e dizem a mesma história — issue
aberta, com o rótulo e atribuída à pessoa —, nos dois idiomas. Nenhuma linha de
comportamento foi tocada. Os achados são sugestões de polimento, não bloqueiam a entrega.

## O que foi conferido, por leitura

Os seis trechos, lidos no estado final do arquivo (não do diff):

1. `docs/configuration.md`, bloco `runner`, linha 73 (pt-BR): a frase do `enabled` diz
   que o app inicia execuções sozinho "só para uma issue **aberta**, com o rótulo
   `triggerLabel` (padrão `coxia`, caixa não importa) e **atribuída à pessoa**", e liga a
   [`runner.md`](runner.md#autonomia-escalonador-e-reinício).
2. `docs/configuration.md`, linha 221 (inglês): a mesma frase, com o link para
   `runner.md#autonomy-the-scheduler-and-restarts`.
3. `src/shared/i18n/ui-team.pt-BR.json`, linha 192 (`ui.runner.enabledHint`): "Ligado, o
   app começa uma execução para cada issue aberta, com o rótulo abaixo e atribuída a
   você. Começar uma execução à mão não depende disto."
4. `src/shared/i18n/ui-team.en.json`, linha 192 (`ui.runner.enabledHint`): "On, the app
   starts a run for each open issue that carries the label below and is assigned to you.
   Starting a run by hand does not need it."
5. `src/shared/i18n/ui-team.pt-BR.json`, linha 253 (`ui.runner.triggerHint`): "A issue
   precisa estar aberta e atribuída a você. Maiúsculas e minúsculas não importam."
6. `src/shared/i18n/ui-team.en.json`, linha 253 (`ui.runner.triggerHint`): "The issue must
   be open and assigned to you. Case does not matter."

Mais:

- `docs/vcs-providers.md`: a linha nova "O gatilho do runner" está na linha 34 (pt-BR) e
  "The runner trigger" na linha 179 (inglês), logo abaixo da linha "Lista 'minhas'". Diz
  que a leitura que alimenta o gatilho é a das issues **abertas atribuídas à pessoa** com
  o rótulo `runner.triggerLabel`, e descreve o filtro de cada host (GitLab
  `issues?scope=assigned_to_me`, GitHub `issues?filter=assigned` ou
  `repos/<proj>/issues?assignee=<usuário>`, Bitbucket `assignee.uuid`). **Não** promete
  que o app reconfere o responsável em todo caminho de leitura.
- `CHANGELOG.md`, `## [Unreleased]` › `### Changed`, linha 15: a entrada diz o que muda
  para quem usa, sem referência interna nem número de issue.
- `src/renderer/src/screens/team/RunnerSection.tsx`: as duas chaves continuam nomeadas —
  `enabledHint` na linha 66, `triggerHint` na 68. Nenhuma chave nova, nenhum texto órfão.
- `docs/runner.md` linha 60: o parágrafo ligado pela documentação de configuração de fato
  diz "lista as issues abertas atribuídas à pessoa que levam o rótulo
  `runner.triggerLabel`". O link leva a um texto que cumpre o requisito.

As duas dicas continuam curtas (duas frases cada), no estilo das outras do mesmo bloco;
nas duas o assunto é atribuição, sem abrir exceção para a autonomia por etapa — o risco
já registrado no plano.

## O que não foi verificado

- A tela de Configurações › Runner: não foi aberta no app. As duas frases foram julgadas
  pelo texto dos catálogos e pelo uso em `RunnerSection.tsx`, não pelo que aparece na
  tela.
- O comportamento do runner: nenhuma execução foi iniciada; uma issue com o rótulo e sem
  responsável não foi vista deixando de iniciar.
- Qualquer host de código real.
- A suíte `npx vitest run` completa **não** passou nesta revisão: 20 testes falharam
  (7 arquivos). As falhas são de ambiente, conforme o achado abaixo.

## Achado sobre a suíte de testes

Nesta revisão, `npx vitest run` foi rodado uma vez sobre todo o repositório: 222 arquivos,
3664 testes, com **20 falhas** em 7 arquivos (`test/release-git.test.ts`,
`test/conflict-resolve.test.ts`, `test/conflict-policy.test.ts`,
`test/updates-source.test.ts`, `test/update-script.test.ts`, `test/runner-chain.test.ts`,
`test/runner-release.test.ts`). Os quatro arquivos que falhavam foram rodados de novo em
isolamento: 24 falhas em 3 arquivos, ou seja as mesmas falhas não vêm da concorrência da
suíte inteira. Nenhuma dessas falhas toca documentação nem catálogos.

O diagnóstico é de licença de teste, não de defeito do produto:

- `test/release-git.test.ts` falha num `afterAll` de limpeza por estouro do limite de
  gancho (10 s), e o arquivo inteiro cai junto.
- `test/conflict-resolve.test.ts` tem testes com limite de 5 s que estouram na montagem do
  repositório de apoio (git é lento aqui) e, em cascata, deixam o estado do conflito
  travado ("este conflito já tem um passo em andamento"), o que arrasta mais testes do
  mesmo arquivo.
- `test/updates-source.test.ts` tem dois testes que estouram os 5 s ao criar clones.
- `test/runner-chain.test.ts` é uma corrida: a execução foi pega em `working` quando o
  teste esperava `question` e expirava a espera; a mudança não toca em nada que a
  explique.

O suíte inteira passou numa execução anterior (relato da etapa de implementação), quando a
máquina estava descansada; esta revisão não reproduziu o resultado verde. Não há evidência
de que a mudança seja a causa: os gates que a mudança de fato afeta passaram (abaixo).

## Gates que rodaram nesta revisão

| Comando | Resultado |
|---|---|
| `npm run i18n:lint` | passou: 4054 chaves nos dois idiomas, 11 catálogos, 0 divergências |
| `node scripts/public-audit.mjs` | passou: 910 arquivos, nada que pertença a empresa ou pessoa |
| `npx tsc --noEmit` | passou, sem saída |
| `node scripts/theme-audit.mjs` | passou: 55 pares de contraste nos dois temas (4.5:1) |
| `npx vitest run` | 20 falhas em 7 arquivos, todas de ambiente (acima) |
| `npx vitest run test/team-catalog.test.ts test/main-catalogs.test.ts test/runner-module.test.ts test/runner-units.test.ts` | passou: 34 testes |

O JSON dos dois catálogos foi aberto e lido: 442 chaves em cada, válido; as duas chaves
têm os mesmos marcadores de substituição nos dois idiomas (nenhum, nestas duas).

## Achados (sugestões)

1. `ui.runner.enabledHint` **não** diz "com o rótulo"; diz o rótulo pelo contexto
   ("com o rótulo abaixo"). Fica ambíguo se alguém ler a frase isolada da caixa. Sugestão:
   dizer "com o rótulo abaixo" já basta; trocar por "com o rótulo do campo abaixo" deixa
   redundante. Sem bloqueio.
2. A linha "O gatilho do runner" cita `runner.triggerLabel` e depois, na mesma célula,
   repete `merge_requests?scope=created_by_me` e `reviewer_username` da linha "Lista
   'minhas'", herdados da fusão. Reduzir a repetição encurta a tabela, mas o conteúdo
   está correto.
3. A entrada do `CHANGELOG.md` diz "a way the app has always worked" — afirmação
   histórica não verificada nesta revisão. O efeito é neutro e a frase pode ficar; se
   houver dúvida, tirar esse trecho não muda o sentido para quem lê.
4. `npx vitest run` não fecha verde nesta máquina (achado acima). Não é defeito da
   mudança; vale como item de acompanhamento de infraestrutura de teste.

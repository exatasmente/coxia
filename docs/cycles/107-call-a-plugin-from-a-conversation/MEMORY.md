# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (enhancement); não é bug, pergunta nem duplicada. Sem pergunta ao autor: a issue já diz o que acontece hoje e o que se espera.
- Três decisões da pessoa, em 1_SPEC.md: comando com barra chama plugin e `@` continua sendo agente; resposta numa conversa de execução também vira documento na pasta do ciclo; telefone pareado pode permitir o pedido da chamada de conversa.
- Plano (2_PLAN.md): evento novo `conversation-called` no catálogo fixo (contrato 1, sem migração); comando = `/` + id do plugin + pergunta não vazia, por função pura em `src/shared/plugins/calls.ts`; mensagem de comando nunca vira menção nem resposta da pergunta de execução; conversa de execução roda com o alvo da execução e conversa comum com pasta vazia própria (`chatTarget`, `documents: false`); resposta entregue como linha do aplicativo via `say` injetável; pedido em Ações ganha `thread`/`asked`, nasce com `holdsRun: false` e é deduplicado por conversa; `plugins:answer` sai de `DESKTOP_ONLY` e o serviço recusa pedido sem `thread` vindo do navegador; o kit ganha `asked`, `thread`, `runId`; a busca na web declara `conversation-called`.
- Implementado na ordem do plano, num commit (`feat: call a plugin from a conversation and answer it there #107`). Uma leitura do plano virou regra: pedido aberto em Ações = `ok: false` com `refused: null`; o ramo de rede devolve `refused: null` nesse caso.
- QA: verificação feita por um arnês de caixa preta descartável que importa os módulos verdadeiros (serviço, leitor de declarações, runtime, política do navegador, catálogos) e conduz a chamada de conversa com dependências falsas; e, na tela, pelo aplicativo numa pasta de dados descartável. Nada no produto foi alterado.
- Resposta: Com /${comando} é comando e @ é agente, uma melhoria, um agente pode chamar outro agente durante a sua rodada e esperar a resposta dele para continuar algo como o sendMessage marcando o agente em questão e se for necessário esperar a resposta o agente que chamou aguarda até o outro responder para continuar, esse ciclo pode ir se expandindo, um agente chamado pode chamar outro e assim em diante até a resposta ser finalizada, deve ter um controle para evitar loops infinitos, conversas demoradas não significam loop, mas assuntos repetitivos, agente fazerem ações que outros já firerazm durante o c… <!-- answer:27 -->
- Resposta: issue separada <!-- answer:35 -->
- Resposta: sim <!-- answer:43 -->
- Resposta: pode permitir <!-- answer:50 -->

## Restrições

- Catálogo fixo e público; declaração com evento fora dele continua recusada; contrato de declaração segue 1.
- `callPlugin` exige `runId` ou `thread`; sem nenhum dos dois a recusa de sempre continua.
- Permissão: rede e escrita pela porta de Ações; o telefone permite só o pedido da chamada de conversa (origem verificada no serviço) e os quatro momentos do ciclo continuam só no computador.
- Resposta na conversa entra cercada como material, nunca como instrução; é linha do aplicativo (o assinante não acorda com ela).
- Nenhum caminho de escrita novo: documento só pela guarda da pasta do ciclo em conversa de execução; pasta de teste não libera requisição nem escrita.
- Repositório público: sem empresa, pessoa, host real, número real ou segredo; exemplos neutros (`example.com`, `group/project`, `#123`).
- Nesta verificação, a sandbox do aplicativo não sobe (o núcleo não permite os namespaces que ela precisa), e `/coxia/out` não guarda arquivo entre um comando e o seguinte: o arnês roda inteiro dentro de um comando só, e o trabalho do Playwright vai para `/coxia/out/evidence`.

## Tentado e descartado

- Descartado no plano (mantido): exigir o interruptor de efeitos externos para o telefone permitir; deixar comando desconhecido sem resposta.
- Duas edições paralelas no mesmo arquivo corromperam `forum.ts` e os catálogos na primeira passagem; refeitas uma a uma.
- `test/plugins-service.test.ts` corre com `CERIMONIAS_DATA_DIR` numa pasta vazia temporária; nunca a pasta da pessoa.
- Nesta verificação, hipóteses derrubadas por leitura: um plugin de shell não pode declarar ajustes nem requisições (o leitor recusa: "settings and requests need a JavaScript entry (.mjs)"); uma escrita reversível sai na hora, a anunciada é a irreversível.
- Descartado: exercitar o caminho do telefone pareado pelo servidor web do app (exige uma sessão pareada com credenciais que esta etapa não tem).

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Entregues: código, testes, 3_IMPLEMENTATION.md, 4_REVIEW.md (aprovada) e 5_TEST_PLAN.md.
- Verificado nesta etapa, num arnês de caixa preta sobre os módulos verdadeiros: os dez critérios, com as duas passagens registradas (`ev-6`, `ev-7`); na tela do aplicativo, o comando escrito na conversa do fórum chega ao plugin e a app responde ali mesmo (`ev-8`).
- Gates nesta árvore: `npx tsc --noEmit` limpo; suíte inteira 415 arquivos, 6898 verdes, 41 pulados, 5 vermelhos (todos fora da mudança: dois arquivos do navegador do app por `@playwright/mcp` ausente, um por disco baixo, um por prazo e um de escrita de caminhos); `node scripts/public-audit.mjs` 1606 arquivos limpo; `npm run i18n:lint` 5491 chaves, 0 achados; `node scripts/theme-audit.mjs` 14 cores literais anteriores. Os arquivos tocados pela mudança passaram todos na mesma passagem (`ev-9`, `ev-10`).
- Não verificado: a sandbox de verdade (não sobe neste computador); a gravação do documento pela busca na web de ponta a ponta; a permissão em Ações contra uma busca verdadeira; os botões da tela do telefone pareado; o rótulo do acontecimento novo na tela de plugins.
- Nada em `/coxia/out` vai para a worktree; só `5_TEST_PLAN.md` foi acrescentado, e o MEMORY.md.
- Passagem support → product-owner: Levar a triagem ao refino do produto: fechar as três decisões de desenho que a issue deixa em aberto (como o plugin é chamado e como isso se distingue de chamar um agente; se a resposta de uma conversa de execução também vai para a pasta do ciclo; o que o telefone pareado pode permitir) e então escrever a especificação. <!-- handoff:14 -->
- Passagem product-owner → pessoa: Levar a especificação fechada para a etapa seguinte do ciclo: as três decisões de desenho já foram respondidas e incorporadas à 1_SPEC.md (comando com barra para plugin e @ para agente; resposta de conversa de execução também vira documento na pasta do ciclo; telefone pareado pode permitir o pedido da chamada de conversa). Nada de código foi alterado e nenhum critério de aceite foi executado — a capacidade nova ainda não existe. <!-- handoff:57 -->
- Passagem tl-plataforma → pessoa: Implementar o plano 2_PLAN.md na ordem que ele dá, com os testes que ele nomeia por comportamento; nada de código foi alterado e nenhum critério de aceite foi executado. Ao terminar a mudança, rodar os gates (npx tsc --noEmit, npx vitest run, node scripts/theme-audit.mjs, npm run i18n:lint, node scripts/public-audit.mjs) e registrar a mudança em CHANGELOG.md sob ## [Unreleased]. <!-- handoff:81 -->
- Passagem developer → revisor-plataforma: Verificar os critérios de aceite da 1_SPEC.md no aplicativo, na ordem dos dez: (1) chamada com barra numa conversa comum vê a resposta cercada como material com as fontes; (2) a mesma chamada numa conversa de execução leva a execução ao plugin e grava o mesmo texto como documento na pasta do ciclo (WEB_SEARCH.md na busca na web); (3) declaração com o evento novo aceita e evento fora do catálogo recusado; (4) plugin desligado, recusado ou sem ajuste obrigatório não roda e a conversa diz o motivo; (5) sem rede, o pedido aparece em Ações e, permitido ali, a resposta chega à conversa; (6) escrita … <!-- handoff:137 -->
- Passagem revisor-plataforma → qa-plataforma-2: A entrega está aprovada: nenhum bloqueante. Os dez critérios de aceite continuam sem execução no aplicativo em funcionamento — o plano já reservava para esta verificação o documento real gravado pela combinação execução, sandbox e busca na web, a permissão em Ações contra uma instância de busca verdadeira e os botões da tela do telefone pareado, que o repositório não cobre com teste de componente. As quatro sugestões (a nova linha sem quebra no fim do arquivo, o aviso de escrita anunciada que não leva a conversa, o caso positivo de um agente chamando um plugin sem teste próprio e a reutilizaçã… <!-- handoff:235 -->

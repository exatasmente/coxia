# A autonomia lida em cada decisão, a sandbox na rede e a lista de comandos: o que está pronto e o que falta

## Veredito

**Muda.** A base desta revisão confere, mas **três dos quatro campos de autonomia não estão ligados** e duas telas prometidas não existem; o critério de aceite 1, o 6 e o 8 do documento de especificação **não são atendidos**.

## 1. O que foi revisado

O trabalho foi lido direto nos arquivos, e os portões foram rodados nesta máquina. O que passo a passo:

- **Configuração**: `src/shared/config/types.ts` (bloco de cinco campos, `SANDBOX_NETWORKS` com `open`, mapa por fluxo), `defaults.ts` (`neutralAutonomy`, `neutralRunner`), `schema.ts` (objetos `autonomy`/`flowAutonomy`), `migrations.ts` (`CONFIG_SCHEMA_VERSION` 16 e o passo `v15ToV16`) e o resolvedor puro `src/shared/config/autonomy.ts`, lidos linha a linha.
- **Os pontos de decisão**: `src/shared/runs/flow.ts` (o valor lido uma vez, na resolução do fluxo), `src/shared/runs/transitions.ts` (a etapa guarda o valor no seu próprio registro), `src/main/runner/service.ts` (o gate aprovado sozinho pelo app, com o motivo e a origem), `src/main/runner/executor.ts` (o comando no computador sem a pergunta) e `src/main/runner/publish.ts` (o push e o pull request), lidos por inteiro.
- **A rede `open`**: `src/main/sandbox/policy.ts` (a montagem deixa de desligar a rede), `src/main/sandbox/system.ts` (o resolvedor de nomes) e `src/main/sandbox/index.ts` (a montagem e o encadeamento do valor guardado), além do teste real de sandbox.
- **Navegador pareado**: `src/main/configScope.ts` (a lista do que o navegador salva e a recusa de elevação) e `src/main/webPolicy.ts`.
- **Telas**: `src/renderer/src/screens/team/RunnerSection.tsx`, `runnerEdit.ts` e a tela da execução, procurando a seção de comandos e o cabeçalho.
- **Portões rodados nesta máquina**, com o resultado que voltou: `npx tsc --noEmit` sem saída (limpo); `npx vitest run` sobre as sete suítes tocadas (migração de esquema, esquema, autonomia, comandos, escopo do navegador, política da sandbox e publicação), **113 casos, todos verdes**; `node scripts/theme-audit.mjs` com só as oito cores literais já conhecidas do editor de texto; `npm run i18n:lint` com 4378 chaves nos dois idiomas; `node scripts/public-audit.mjs` com 1088 arquivos e nada de empresa ou pessoa.

## 2. O que está pronto e confere

- **O bloco existe nos dois lugares e é lido no ponto certo.** Quem decide uma execução é o bloco do fluxo quando o interruptor "usar a configuração do espaço de trabalho" está desligado, e o do espaço de trabalho quando está ligado ou quando o fluxo não tem bloco próprio. Sem entrada para um fluxo, a leitura é "tudo desligado e o espaço de trabalho decide". O teste próprio cobre as duas precedências.
- **A migração não eleva nada.** Um documento guardado ganha o bloco do espaço de trabalho com os cinco campos desligados e o mapa de fluxos vazio, e a rede da sandbox **não é tocada**; um bloco que já exista é mantido. O teste cobre a migração e o passo é idempotente.
- **A decisão da autonomia é lida uma vez, na resolução do fluxo**, e o valor é guardado na própria etapa: uma mudança vale a partir da próxima etapa, nunca no meio.
- **O gate com a escolha ligada** é aprovado pelo app e registrado como aprovação automática, com o motivo dizendo de onde a decisão veio; sem a escolha, o gate espera como hoje.
- **O comando de um agente com `shell: host`**, com a escolha ligada, roda sem a pergunta; sem ela, a pergunta continua.
- **A rede `open`**: a montagem deixa de desligar a rede só nesse valor e mantém os outros isolamentos; não são postas as variáveis de proxy; o alvo real da configuração do resolvedor do sistema e o caminho convencional são montados somente leitura, dentro da lista de montagens que passa pela checagem de segurança. **O teste real de sandbox foi executado nesta máquina** e mostrou que existe uma interface da máquina dentro da sandbox e que um nome público é resolvido; o teste é pulado onde a máquina não tem sandbox.
- **O navegador pareado só desce**: o bloco do espaço de trabalho e o da sandbox ficam fora da lista que o navegador salva, e o bloco de cada fluxo, que está dentro, recusa qualquer campo que passe de desligado para ligado e recusa desligar o interruptor que entrega a decisão ao fluxo. O teste fixa as duas recusas.
- **Os textos**: o contrato do campo `autonomous` de um agente já não diz que o push e o pull request esperam sempre, a lista de canais do navegador ganha o bloco do fluxo, e o histórico do esquema ganha o passo novo na documentação da configuração.

## 3. O que falta, e por que bloqueia

### 3.1 O push e o pull request ainda esperam sempre

A escolha "Push sem sim" e a escolha "Pull request sem sim" não são lidas em nenhum lugar: o arquivo que publica não foi tocado nesta passada. No fim da etapa que muda o código, o push vira uma proposta em Ações; depois dele, o pull request vira outra proposta, com o seu próprio "sim". Isso é exatamente o comportamento de hoje e contradiz o critério de aceite 1 (a execução vai do começo ao pull request sem esperar a pessoa) e o item 6 da especificação. O caminho autônomo da porta para os dois ficou desenhado e não escrito.

### 3.2 A lista de comandos não existe

O módulo puro que agrupa por agente e por etapa existe e tem teste, mas **nada o usa**: não há seção de comandos na tela, não há mensagem única ao fim da execução e não há chave de catálogo para ela. O critério de aceite 6 fica sem atendimento: nem a lista ao vivo, nem a mensagem final, nem o "por agente" na conversa quando a execução termina (concluída, cancelada ou falhou).

### 3.3 O cabeçalho da execução e as telas do bloco

Nem o cabeçalho da execução diz que ela é autônoma, quais das quatro escolhas estão ligadas e de onde vêm, nem as telas do bloco de autonomia (Configurações › Runner e a edição de cada fluxo, com o interruptor e os campos desabilitados com a dica) foram escritas. O critério de aceite 8 e o item 11 da especificação ficam sem atendimento; o seletor de rede ganhou o terceiro valor, e só.

## 4. Observações menores

- **A rede `open` alcança a interface da máquina, e isso é o pedido**, mas a seção "Não verificado" do documento do runner precisa dizer com clareza que a rede nasce não exercitada quanto a **alcançar** um endereço público de verdade, não só quanto a resolver o nome; o que foi visto aqui foi a resolução e a existência da interface, não uma conexão completa.
- **A linha que diz que um comando rodou neste computador sob a autonomia do ciclo** (a recomendação que a especificação registra) não aparece: hoje o comando autônomo sai na conversa igual a um comando permitido pela pessoa, sem marca de origem. É decisão da pessoa, mas vale dizer que a recomendação não foi seguida.
- **A execução de release** fica fora das duas escolhas, como a pessoa recomendou, e isso está preservado por construção: como as escolhas não são lidas, a release não muda. Quando o caminho autônomo for escrito, essa exclusão tem de ser explícita e testada.

## 5. O que não foi revisado

A seção de comandos na tela, a mensagem final e as telas do bloco de autonomia **não existem para revisar**. Nenhuma tela foi aberta e **nada do comportamento novo foi visto funcionando no aplicativo**: o que se viu foi o código, os portões e o teste real da sandbox, não uma execução do ciclo. O rebase sobre a `release/0.7.0` foi conferido pelo estado do repositório, não pelo histórico de commits, que não mostra o rebase.

## 6. Como foi conferido

Leitura direta dos arquivos citados e execução dos portões nesta máquina: verificação de tipos, suíte de testes das sete áreas tocadas, auditoria de cores, catálogo de textos e auditoria de repositório público. **As três escolhas de autonomia que não estão ligadas e as duas telas ausentes foram conferidas por ausência**: não há leitura do bloco no arquivo que publica, não há uso do módulo de agrupamento, não há componente de comandos, não há chave de catálogo para a mensagem final. Nada disso foi dado como feito; é o que falta.

# O Coxia passa a aceitar plugins e a vir com um jeito de escrevê-los

## O que se pede

A issue pede uma plataforma, não um interruptor. Nas palavras dela:

> Everything new in Coxia should extend the platform through plugins — hooks, events and actions — rather than being added to the core. [One named integration], [another] and the other integrations are the examples; none of them should require changing the core.
>
> Today there is no plugin concept in the code: `grep -i plugin` under `cerimonias/src` returns nothing, and `src/shared/config/types.ts` has no field for plugins or extension points. This is a platform to build, not a switch to flip.
>
> This is the foundation the other items depend on: without it, new artifact types and new integrations become ad-hoc code.

E, sobre o que precisa ser decidido:

> - The minimum scope of the first plugin: one new artifact plus one external integration (for example [one named integration]) would exercise event → artifact → external effect without opening three fronts at once.
> - The boundary of a plugin: what it can see, what it can trigger and where it runs. A public app that runs plugin code against people's data needs this boundary defined before any plugin ships.

A aceitação, ainda nas palavras dela:

> - A new plugin installs and extends the app without modifying the core.
> - A plugin does not reach secrets or another workspace's data without an explicit permission.
> - A new artifact type is addable without touching the core (the test case for the platform).

A nota da issue diz que o contrato de extensão fica para o refino e o plano. Nada aqui decide esse contrato: esta especificação diz o comportamento que a plataforma precisa entregar.

## O que esta mudança entrega

Uma capacidade nova do aplicativo, em três partes, entregues juntas:

- **Aceitar plugins.** Um plugin é uma unidade da equipe que o aplicativo lê de uma pasta do espaço de trabalho. Ele declara o que oferece; o aplicativo lê essa declaração, confere que ela é válida e liga o que ela oferece. É a equipe que escreve o plugin (decisão de quem abriu a issue), e a unidade é a mesma para todos: não há um caminho especial para o código do núcleo.
- **Um kit de desenvolvimento.** Uma pasta de documentação e um exemplo que compila, que dizem como se escreve um plugin, o que ele pode oferecer e o que ele recebe, e que servem de ponto de partida para o próximo.
- **A primeira entrega de verdade.** Um plugin que dá aos agentes a capacidade de buscar na web e que exercita a plataforma de ponta a ponta: um acontecimento que o aplicativo já publica, um tipo de documento novo no ciclo que guarda o resultado da busca e leva a fonte consultada, e uma escrita externa nova que dispara pela porta única de efeitos.

O trabalho termina quando ligar e desligar um plugin é uma operação da pessoa, no espaço de trabalho dela, e o código do aplicativo é o mesmo antes e depois.

## O que muda para quem usa

Hoje, uma capacidade nova no Coxia é código dentro do aplicativo; quem usa recebe o que a versão traz. Depois desta mudança passa a existir um segundo caminho: uma pasta de plugins no espaço de trabalho, com uma lista do que está ligado, cada um podendo ser ligado e desligado, cada um dizendo o que oferece e o que pode alcançar.

- Uma pessoa que escreve plugins tem onde colocar o código e uma referência para escrevê-lo, em vez de ler o aplicativo inteiro para descobrir por onde entrar.
- Quem usa o aplicativo vê, num lugar só, o que cada plugin ligado oferece e a que ele tem acesso; um plugin desligado não oferece nada e não é executado.
- Uma integração passa a poder nascer fora do núcleo: nada do comportamento do aplicativo muda, e o que entra por plugin não mistura código de plugin com dado de outra pessoa.
- Os agentes passam a poder buscar na web por um plugin da equipe; o resultado da busca entra no ciclo como um documento com as fontes de onde veio, e o que ele pede para fora espera o "sim" da pessoa. O acesso à rede continua sendo só o que a pessoa liberou para aquele espaço de trabalho, e nenhum plugin contorna isso. A escrita externa que o exemplo exercita é um destino neutro, não um serviço de terceiro.
- O que o aplicativo já faz — as cerimônias, o ciclo, as ações, os gates humanos, o "sim" antes de qualquer escrita para fora — continua como está. Um plugin não ganha um caminho mais curto para nada disso.

## Regras

1. **Um plugin é uma pasta com uma declaração.** A pessoa aponta a pasta que guarda os plugins do espaço de trabalho. Cada plugin é uma pasta dentro dela, com uma declaração que diz o nome, a identidade do plugin e o que ele oferece. Sem um dos dois, ou com dois plugins de mesma identidade, a leitura é recusada.
2. **O caminho de leitura é único.** Um plugin é carregado pelo mesmo caminho em qualquer máquina, no Linux, no macOS e no Windows: nada nele pode depender de um carregador de biblioteca nativa da plataforma.
3. **O ciclo é longo.** O aplicativo não reinicia para ligar ou desligar um plugin. Ligar e desligar vale a partir da próxima coisa que usa aquela capacidade: as etapas já em andamento terminam como começaram.
4. **A lista de plugins é do espaço de trabalho** e é visível: nome, o que oferece, o que pode alcançar e ligado/desligado. Ligar um plugin é decisão da pessoa, no computador; um navegador pareado não liga nem desliga plugin.
5. **Desligado é desligado.** Um plugin desligado, ou com a declaração recusada, não oferece nada e não é executado: nenhum hook dele roda e nada que ele registre aparece.
6. **Os hooks.** Um plugin pode reagir a um conjunto nomeado de acontecimentos do aplicativo, com um conjunto fixo e público, publicado no kit. Um acontecimento fora da lista é recusado, com o motivo. O catálogo não é um canal de interface entre a janela e o navegador.
7. **As ações.** Um plugin pode pedir uma escrita externa. A escrita sai só pela porta única que já existe, depois da permissão da pessoa (ver "O contrato de permissão"), é recusada num espaço de trabalho de teste e entra no registro de auditoria quando de fato acontece — nunca uma linha de auditoria sobre um efeito que não houve. Um plugin não recebe um caminho para escrever por fora dessa porta, e nunca por conta própria. Na primeira entrega, a escrita externa vai para um destino neutro declarado pelo próprio plugin, não para um serviço de terceiro nomeado.
8. **Os documentos.** Um plugin pode declarar um tipo de documento novo do ciclo. O tipo pode entrar na pasta de uma execução e ser lido por um gate, sem mudar o código que lê os tipos de hoje; a pessoa e o agente veem o tipo do mesmo jeito que os outros.
9. **A fronteira.** Um plugin não recebe, por existir, nada do que é da pessoa: as chaves guardadas, a pasta pessoal, e o dado de outro espaço de trabalho ficam fora. O que ele pode alcançar está declarado no plugin e é dito na lista da Regra 4; o que não estiver declarado é recusado, com o motivo.
10. **Permissão é da pessoa.** Ampliar o que um plugin alcança (mais projetos, um destino na rede, uma escrita externa) é decisão da pessoa, no computador, e nunca de quem importou um arquivo, de um navegador pareado ou do próprio plugin. Um espaço de trabalho de teste não amplia. Um navegador pareado pode **reduzir** (bloquear uma escrita no aviso com prazo), nunca conceder.
11. **O que o aplicativo já garante continua.** Todo texto que vem de um plugin entra como material, entre as marcas que o aplicativo já usa; nada dele é tratado como instrução. Um plugin não ganha um caminho que não passe pela regra de segredo e pela auditoria, e o que ele escreve para fora passa pelo mascaramento de sempre.
12. **O que falha não derruba o aplicativo.** Uma declaração inválida, um plugin que não carrega ou um hook que falha não impedem o Coxia de abrir nem as outras etapas de rodar: o motivo é dito na lista de plugins, e o resto do aplicativo segue.
13. **Sem plugin, nada muda.** Um espaço de trabalho sem plugins se comporta exatamente como hoje, e o arquivo de configuração dele continua válido.
14. **A rede não é uma brecha.** Um plugin só alcança a rede depois de a pessoa conceder a ele a rede que ele declarou, e só para os destinos que ele declarou — nem os destinos que o espaço de trabalho libera para as etapas, nem outro; sem a concessão o plugin pede, e enquanto ela não vem ele não roda. Um resultado de busca entra como material do plugin: carrega a fonte de onde veio, não vira instrução e não substitui o que a pessoa escreveu. O conteúdo buscado nunca é escrito de volta no aplicativo sem passar pela porta única da Regra 7.

## O contrato de permissão

Decidido pela pessoa na revisão (respostas às perguntas da rodada 1 e ao refino desta rodada). Vale para a rede e para a escrita externa de um plugin, cada uma com a sua permissão.

1. **O plugin pede, a pessoa permite.** Quando um plugin precisa da rede que declarou, ou vai fazer a escrita externa que declarou, e não tem permissão para isso, o aplicativo abre um pedido em Ações com o plugin, o que ele quer e por quê. A pessoa responde **uma vez** (vale só para aquele pedido), **na sessão** (vale até o aplicativo fechar), **sempre** (fica guardada) ou **recusar**.
2. **A execução espera a resposta.** Enquanto um pedido de plugin de uma execução espera a pessoa, a execução não começa a etapa seguinte: ela fica esperando, com o motivo em palavras ("o plugin X pede rede"), e segue quando a pessoa responde — permitindo ou recusando. Uma recusa não derruba a execução: o plugin não roda (ou a escrita não sai), o motivo fica na conversa da execução, e o ciclo segue. Um pedido de uma execução que já terminou não segura nada; ele só espera em Ações.
3. **"Sempre" é durável e é da pessoa.** O que foi permitido sempre fica na lista de permissões do plugin, no espaço de trabalho, até a pessoa retirar. Desligar e religar o plugin não apaga a permissão. "Na sessão" acaba quando o aplicativo fecha; "uma vez" acaba com o pedido.
4. **O plugin pede enquanto não for "sempre".** Um plugin com "uma vez" ou "na sessão" volta a pedir quando a permissão acaba; um plugin recusado volta a pedir no próximo acontecimento que observar. Nada pede de novo enquanto houver um pedido igual esperando.
5. **Escrita que não se desfaz.** Cada escrita que um plugin declara diz se pode ser desfeita. Uma escrita que não diz nada conta como **irreversível**. Uma escrita irreversível só pode ser permitida **sempre** — o pedido oferece "acrescentar à lista de permissões" e "recusar", nunca "uma vez" ou "na sessão".
6. **Aviso com prazo.** Toda escrita irreversível já permitida é anunciada antes de sair: Ações mostra o aviso com a contagem do prazo, e nesse intervalo a pessoa pode **bloquear** (aquela escrita não sai) ou **revogar** (a escrita não sai e a permissão sai da lista). Passado o prazo sem resposta, a escrita sai pela porta única. O prazo é um valor do espaço de trabalho, configurável, com **30 segundos** por padrão.
7. **Onde se vê e onde se retira.** A lista de plugins mostra, por plugin, o que ele pede (rede, escrita, reversível ou não) e o que foi permitido sempre; retirar uma permissão é ali, no computador. A lista de permissões não viaja numa exportação de configuração e uma importação não a altera.



O kit é uma pasta no repositório, não um segundo produto. Ele traz:

- o contrato que um plugin implementa e a declaração que ele publica, com os tipos de tudo que atravessa a fronteira;
- a lista dos acontecimentos que um plugin pode observar (Regra 6) e os gatilhos disponíveis, com o significado de cada um;
- como se declara um tipo de documento novo, como se pede uma escrita externa e como se declara o que o plugin precisa da rede;
- um exemplo que compila e roda, e que é a base da primeira entrega (abaixo);
- o caminho de carregamento que vale nas três plataformas (Regra 2), e a regra de que a configuração do espaço de trabalho é a única entrada de um plugin.

O kit não ensina a contornar a fronteira: onde ele mostra uma permissão, mostra também o que é recusado sem ela.

## A primeira entrega

A primeira entrega é o caso de teste da plataforma. Ela usa a plataforma como qualquer plugin a usaria e prova que o núcleo não precisou mudar. Quem abriu a issue escolheu o que ela é: um plugin que dá aos agentes a capacidade de buscar na web.

O escopo mínimo da issue — "one new artifact plus one external integration ... exercise event → artifact → external effect without opening three fronts at once" — fica assim com nome concreto:

- **O acontecimento.** Uma etapa do ciclo termina (ou um gate é decidido) e o plugin é chamado; é o gatilho que hoje o aplicativo já publica.
- **O documento novo.** O resultado da busca entra na pasta da execução como um tipo de documento novo, com as fontes consultadas, sem tocar no código que lê os documentos de hoje.
- **A escrita externa.** O que o plugin pede para fora entra na porta única de Ações e espera o "sim" da pessoa; nada é escrito por fora dela, e num espaço de trabalho de teste a confirmação é recusada.

A busca na web em si é a capacidade nova que este plugin traz; o desenho da plataforma é o que a permite existir sem virar código do núcleo. O que a primeira entrega prova: ligar o plugin acrescenta o documento novo à pasta do ciclo e faz a capacidade aparecer para os agentes; desligar faz tudo isso desaparecer; e nada do núcleo mudou para isso acontecer.

A escrita externa da primeira entrega fica num destino neutro que o próprio plugin declara: ela exercita a porta única de Ações sem depender de um serviço de terceiro nomeado. O destino neutro é um exemplo do kit, não um destino real; o serviço de verdade fica para o plugin de busca que for construído depois, em outra issue. Nada na plataforma muda por causa disso.

## Fora do escopo

- **Plugin como código de terceiro**: distribuir, baixar, assinar ou publicar plugin não entra. Os plugins são código da equipe (decisão de quem abriu a issue).
- **Um catálogo ou uma loja de plugins.**
- **Uma instalação por plugin, com empacotamento e dependências próprias**: um plugin é uma pasta do espaço de trabalho, não um pacote que se instala.
- **Permitir que um plugin escreva no código do repositório ou mexa no worktree de uma execução.**
- **Um plugin rodar código próprio com a autoridade do aplicativo**, fora da sandbox: o contrato de execução é do plano, e o que já existe (a sandbox por etapa, a porta única de efeitos externos) é o ponto de partida.
- **Um segundo provedor de busca como plugin, ou escolher o provedor de busca da primeira entrega**: a primeira entrega prova a plataforma com um plugin; o provedor de verdade é assunto de outra issue.
- **Uma escrita externa de verdade para um serviço nomeado na primeira entrega**: a escrita externa do exemplo fica num destino neutro que o próprio plugin declara; o serviço de verdade é assunto do plugin de busca que vier depois.
- **Nomear "os outros itens" que dependem desta plataforma** e planejar cada um: esta mudança entrega a plataforma, não as capacidades que virão por ela.
- **A escolha do mecanismo**: onde a declaração vive, como é lida, como é validada, e como o kit é publicado é do plano e da implementação; aqui só ficam o comportamento e a fronteira.
- **Mudar qualquer coisa que o aplicativo já faz hoje**, inclusive o caminho de escrita externa e o catálogo de acontecimentos que a janela usa hoje.

## Aceitação

Cada item é algo que uma pessoa consegue conferir no aplicativo.

1. Uma pasta de plugins com um plugin válido é lida; a lista mostra o nome, o que ele oferece, o que ele pode alcançar e o estado dele.
2. Ligar o plugin acrescenta o que ele oferece (o tipo de documento novo aparece onde os outros aparecem, e a capacidade nova aparece para os agentes); desligar o plugin faz tudo isso desaparecer, sem reiniciar o aplicativo.
3. Um plugin desligado não roda: nenhum hook dele é chamado e nada que ele registre aparece.
4. Um plugin com declaração inválida, ou com identidade repetida, é recusado com o motivo, e o Coxia abre normalmente.
5. O tipo de documento novo entra na pasta do ciclo da execução sem mudar o código que lê os tipos atuais: lido no mesmo caminho, conferido por um gate.
6. O plugin de busca, sem permissão de rede, pede a permissão em Ações e a execução espera; permitido (uma vez, na sessão ou sempre), ele roda alcançando só os destinos que declarou; recusado, ele não roda, a execução segue e a conversa diz o motivo; o resultado que entra no ciclo carrega a fonte de onde veio.
7. A escrita externa pedida pela primeira entrega, num destino neutro declarado pelo próprio plugin, sai só depois da permissão; num espaço de trabalho de teste ela é recusada e nada é escrito; o que de fato saiu fica no registro de auditoria.
8. Um plugin tentando alcançar uma chave guardada, a pasta pessoal ou o dado de outro espaço de trabalho é recusado com o motivo, e o plano do plugin diz onde essa recusa mora.
9. Um espaço de trabalho sem plugin abre e se comporta como hoje, com a configuração atual válida.
10. O kit existe no repositório, compila e traz um exemplo que pode ser lido por quem for escrever o próximo plugin; o que ele diz que o aplicativo recusa é o que o aplicativo recusa.
11. `node scripts/public-audit.mjs` passa com o kit e o exemplo; nenhum teste do kit alcança um modelo, um host real ou a rede.
12. "Sempre" sobrevive a desligar e religar o plugin, a fechar e abrir o aplicativo e a uma importação de configuração; "na sessão" não sobrevive a fechar o aplicativo; retirar na lista de plugins faz o plugin voltar a pedir.
13. Uma escrita declarada irreversível (ou que não diz) só oferece "acrescentar à lista" e "recusar"; já permitida, ela aparece em Ações com a contagem do prazo do espaço de trabalho (30 s por padrão), e bloquear ou revogar dentro do prazo impede a escrita; revogar também retira a permissão.
14. Permitir um pedido de plugin (uma vez, na sessão ou sempre), ligar ou desligar um plugin e retirar permissão não é possível de um navegador pareado; recusar um pedido e bloquear uma escrita no aviso, que só reduzem, são.

## Verificação

Nesta etapa só documentos foram escritos, e a leitura abaixo foi feita no código desta árvore de trabalho. Nenhum plugin foi carregado, nenhuma extensão de plugin existe no código, nenhum teste ou gate foi rodado: a plataforma pedida não existe para ser vista funcionando. As respostas de quem abriu a issue nesta etapa foram lidas e fixaram a primeira entrega (o plugin de busca na web) e a escrita externa num destino neutro.

| Afirmação | Como foi conferida | Situação |
|---|---|---|
| Não há conceito de plugin sob `src/` | Busca por `plugin` em `src/` e em `docs/`: nenhum ponto de extensão; só o plugin de build em `package.json` | Não verificado em execução (leitura) |
| A configuração não tem campo de plugin | Leitura de `WorkspaceConfig` (`src/shared/config/types.ts:784-810`) e das seções `externalTools` (`:667-673`) e `runner` | Não verificado em execução (leitura) |
| Não há barramento de eventos de plugin | Leitura de `AppEvent` (`src/shared/types.ts:444-453`): é canal de interface entre a janela e o navegador | Não verificado em execução (leitura) |
| Já existe uma porta única de escrita externa | Leitura de `src/main/actions.ts` (o caminho de proposta, aprovação e auditoria) e do que a Regra 7 usa dela | Não verificado em execução (leitura) |
| Já existe uma fronteira de execução fechada | Leitura de `src/main/sandbox/policy.ts` e `src/main/webPolicy.ts:11,21`: sandbox por etapa, política de permissão do navegador pareado | Não verificado em execução (leitura) |
| A rede de um sandbox já é fechada por padrão e só sai por lista | Leitura de `SANDBOX_NETWORKS`/`RunnerSandbox` (`src/shared/config/types.ts:687-715`), de `sandboxEnv`/`bwrapArgs` (`src/main/sandbox/policy.ts:30,71,87`) e do proxy de registro (`src/main/sandbox/proxy.ts:6-9`) | Não verificado em execução (leitura) |
| Já existe um lugar de tipos de documento do ciclo | Leitura de `SpecLayout` (`src/shared/config/types.ts:252-270`) e `GateFiles` (`:244`), que os gates leem | Não verificado em execução (leitura) |
| A configuração tem versão de esquema e um conjunto de campos com padrão | Leitura de `CONFIG_SCHEMA_VERSION` (`src/shared/config/types.ts:5`) e do histórico de esquemas (`docs/configuration.md`) | Não verificado em execução (leitura) |
| Já existe uma leitura de web para os agentes de sistema | Leitura de `src/main/agents.ts:406-407` (`WebFetch`, `WebSearch` na lista de ferramentas) | Não verificado em execução (leitura) |
| As integrações nomeadas na issue não existem em nenhum documento além dela | Busca por elas em `docs/` | Não verificado em execução (leitura) |

O contrato de extensão — por onde o script do plugin é carregado, com que autoridade ele roda e onde a declaração é validada — não foi desenhado nesta etapa; é do plano. O mecanismo, a forma da declaração e a execução do código do plugin ficam como decisão técnica, presos ao comportamento e à fronteira descritos aqui.

## Prioridade e marco

- **Prioridade: alta**, um dos níveis que o espaço de trabalho grava no host de código; a issue já chega com `priority:high` e nada nesta etapa mudou isso.
- **Motivo:** é fundação declarada por quem abriu a issue: sem ela, "new artifact types and new integrations become ad-hoc code". Nada quebra hoje, então não é urgência de defeito; o que ela impede é que cada capacidade nova nasça como código do núcleo. Quem abriu a issue já disse o que quer primeiro por ela — um plugin de busca na web para os agentes —, o que põe a plataforma antes dessa capacidade. Marco proposto a confirmar: a mesma entrega em que o acesso à rede e a busca entrarem; a lista de marcos do host não foi alcançada nesta etapa.

## Perguntas em aberto

1. **O que são os itens que a issue chama de dependentes?** A issue diz que "the other items depend on" a plataforma e não nomeia nenhum; a resposta de quem abriu a issue também não nomeou, e nada no repositório os define. Quais são define o alvo do contrato — que acontecimentos, que tipos de documento e que integrações precisam entrar por ele. **Recomendação:** seguir com o contrato mínimo das Regras 6 a 8 e deixar o alvo maior para quando os itens forem nomeados; se o contrato precisa nascer do alvo, essa lista precisa vir da pessoa antes do plano.
2. **O que este espaço de trabalho considera "permissão explícita" de um plugin.** A aceitação pede que um plugin "does not reach secrets or another workspace's data without an explicit permission"; o que o aplicativo já garante (Regra 9) cobre o serviço de entrada, e o que fica além disso é escolha da pessoa: quais projetos do host um plugin pode ler, e se ele pode ter um caminho para fora declarado por ele. **Recomendação:** partir fechado (nada de segredo, nada de pasta pessoal, nenhum espaço de trabalho que não seja o que ligou o plugin) e tratar toda ampliação como permissão que só o computador concede, como a Regra 10.

# Memória do ciclo

## Decisões

- A issue foi classificada como **pedido de funcionalidade** (`enhancement`); nenhuma issue a duplica. A triagem não achou nada faltando que só quem abriu possa dizer e nada foi perguntado na issue.
- O refinamento escreveu a especificação funcional (`1_SPEC.md`), nas palavras do produto: o que muda para quem usa, o pedido citado, as regras, as decisões que são da pessoa, o fora do escopo e dez critérios de aceite. Nada foi executado e nenhum comportamento novo foi visto funcionando.
- **Bloco de autonomia: cinco campos, todos desligados**, em dois lugares (espaço de trabalho e cada fluxo, com o interruptor "Usar a configuração do espaço de trabalho" ligado por padrão). O bloco é um segundo caminho: a chave `autonomous` de cada agente e a do squad continuam valendo, como a issue pede. Trocar um campo vale a partir da próxima decisão, nunca no meio de uma.
- **As quatro escolhas**, cada uma ligada em separado: comando `host` sem a pergunta; gate aprovado sozinho pelo app, registrado como aprovação automática com o motivo e a origem; push pela porta sem esperar o "sim", auditado; pull request aberto sozinho, auditado.
- **Só o computador liga** (qualquer campo e a rede `open`); o navegador pareado só desliga. Espaço de trabalho de teste continua recusando o push e o pull request mesmo com os dois campos ligados.
- **Rede `open`**: terceiro valor de `runner.sandbox.network`, compartilha a rede do computador, sem proxy nem lista de endereços; só no desktop; desligada por padrão e a migração não liga nada; resolver nomes tem de funcionar dentro, sem abrir o resto do sistema; o texto da etapa diz ao agente que ele tem rede.
- **Lista de comandos**: seção "Comandos" na tela da execução, por agente e por etapa, com número, comando, onde rodou, resultado (código de saída, tempo estourado, recusado, não permitido, não terminou) e duração; ao vivo; no fim (concluída, cancelada ou falhou) uma mensagem na conversa com a mesma lista; feita do que a execução já registra; nunca vai ao host.
- **Recomendação sobre a release**: as escolhas de push e de pull request **não alcançam** uma execução de release (os passos `beta`, `stable`, `push-branch`, `push-tag` continuam sempre esperando o "sim", pelo motivo de D18); é recomendação, porque a decisão é da pessoa.
- Fora do escopo, como a issue pede: responder a pergunta que chegou à pessoa, o pedido de um plugin, um provedor sem orçamento e as etapas de espera continuam esperando; nenhum ajuste por execução na hora de iniciar.
- Prioridade proposta: `priority:medium`; marco: nenhum. É proposta para a pessoa aceitar.

## Restrições

- O que hoje está de pé e prende o trabalho: a regra "o push e o pull request esperam sempre um 'sim'" está escrita em três lugares da documentação do runner (o resumo, o parágrafo do push e do pull request e a lista de canais do navegador) e no contrato do campo `autonomous`; o contrato de `shell: host` diz que cada comando espera a permissão; a seção "Não verificado" descreve a sandbox como exercitada sem rede de verdade. Todos esses textos mudam de sentido, e a spec diz quais.
- O que não pode regredir: a migração **nunca eleva** nada (todo espaço de trabalho existente fica com os cinco campos desligados e a rede como estava), um espaço de trabalho de teste continua recusando toda escrita externa, e a elevação continua só no computador.
- A chave geral só é sincronizada de verdade se todas as etapas compartilharem o início da execução; um agente numa etapa que não encontra a chave geral cai na chave dele, e a spec diz que ele fica como está hoje (não é um caminho proibido, é um agente que segue esperando).
- A rede `open` é a rede do computador inteira, sem filtro: é uma escolha de risco da pessoa, e o padrão continua fechado.
- Onde não há sandbox (macOS, Windows, Linux sem bubblewrap), nada disso muda.

## Tentado e descartado

- Perguntar a quem abriu sobre a rede da sandbox e a resolução de nomes: descartado na triagem, o problema é de desenho (o resolvedor é um link fora de `/etc`).
- Tratar como duplicata as issues do mesmo território (permissões e sandbox, memória do ciclo, runner e pasta do ciclo, processo de release): cada uma define regras que esta estende ou move.
- Fazer o bloco de autonomia decider também **quais** agentes existem na instalação nova da chave geral: descartado, a issue não pede e é perigoso (um agente que o dono pôs de propósito passaria a decidir sozinho).
- Deixar o bloco decidir o `git push` de uma release: descartado, contradiz D18; a controvérsia fica como decisão da pessoa na spec, com a recomendação de manter a release fora.
- Projetar a solução (onde o campo mora, como a montagem da rede é feita, como a lista é montada): fica para o planejamento; a spec só descreve comportamento.

## Perguntas abertas

- **Da pessoa**: (1) o push e o pull request de uma execução de release ficam fora das duas escolhas (recomendação) ou o bloco alcança também uma release; (2) o que a tela mostra quando um comando `host` roda sem a pergunta (recomendação: uma linha dizendo que rodou neste computador sob a autonomia do ciclo); (3) em que tela fica o bloco do fluxo; (4) a rede `open` como padrão de instalação nova (recomendação: continuar desligada). As duas primeiras são risco/escopo; as duas últimas são de tela e de padrão.
- **Do planejamento**: o número do esquema de configuração e o passo de migração; como a montagem da rede resolve nomes sem abrir o resto do sistema; de onde a lista de comandos é montada e como a mensagem final entra na conversa.

## Onde o trabalho está

Refinamento concluído. `1_SPEC.md` escrito na pasta do ciclo com a especificação funcional (o que muda para quem usa, o pedido citado da issue, as regras dos dois blocos de autonomia e das quatro escolhas, a rede `open`, a lista de comandos, onde a regra de hoje muda, as decisões que são da pessoa, o fora do escopo e dez critérios de aceite). `0_ISSUE.md`, `0_TRIAGE.md` e `MEMORY.md` como estavam. Nenhum código e nenhum outro documento foram tocados; nada foi executado. A próxima etapa é o planejamento da solução.
- Passagem product-owner → planejamento: a especificação funcional está fechada em `1_SPEC.md`; falta o desenho (onde cada campo mora, como a montagem da rede é feita, como a lista é montada e como o fim da execução a posta na conversa), o número do esquema e o passo de migração, e os testes que sustentam cada critério de aceite. As quatro decisões da pessoa estão na seção 4 da spec; nenhuma delas bloqueia o plano, que pode seguir a recomendação e deixá-las em aberto.
- Passagem support → product-owner: A triagem não achou nada faltando que só quem abriu possa dizer, então a etapa seguinte é o refinamento do produto (product-owner), que deve escrever a spec funcional nas palavras do produto e propor prioridade e marco. O que ele precisa decidir, a partir desta triagem e do código: (1) onde fica o bloco de autonomia em cada um dos dois lugares e o que exatamente cada uma das quatro escolhas muda; (2) se o interruptor de push e pull request alcança uma execução de release, porque a decisão D18 do processo de release manda os cortes e os envios (`beta`, `stable`, `push-branch`, `push-tag`) esper… <!-- handoff:6 -->

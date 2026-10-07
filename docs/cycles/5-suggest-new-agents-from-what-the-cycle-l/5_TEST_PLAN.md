# O teste da sugestão de agentes a partir do ciclo

## O que este plano cobre

Testar se o que foi entregue se comporta como a especificação pede: o aplicativo lê o
histórico que já grava, propõe um agente novo quando um padrão se repete, mostra a
evidência, e deixa a decisão — aceitar, editar ou recusar — registrada nos dados do
espaço de trabalho, de modo que uma recusa não volte igual. Cada critério de aceitação
tem um cenário abaixo, com o que o sustenta.

Fora do escopo do teste: o comportamento do modelo real (os testes usam um modelo
simulado), o volume real do histórico, o limiar medido em uso e a renderização numa
tela de verdade. Nada disso foi exercitado, e cada cenário diz quando só foi lido.

## Como foi testado

Duas vias, e cada cenário diz qual usou:

- **A suíte do repositório**, que é a via principal: ela não toca a rede nem um modelo
  real, e cobre a leitura pura, o registro e o fluxo de ponta a ponta com um modelo
  simulado (`test/suggestions.test.ts`, `test/suggestions-module.test.ts`,
  `test/team-suggestion-edit.test.ts`).
- **Uma trilha descartável**, rodada nesta etapa e depois apagada: ela fez um ciclo
  inteiro acontecer de verdade num repositório temporário (`boot` de
  `test/helpers/runner.ts`) — três execuções que devolvem o trabalho à mesma etapa,
  chegam ao limite de rodadas e recebem a pessoa — e então leu os arquivos que o
  aplicativo gravou, em vez de chamar as funções exportadas com objetos montados à mão.
  O modelo foi simulado; o resto (worktree, commits, limites, registro das execuções)
  foi o real. A trilha descrevia o resultado no terminal, não afirmava nada por si; as
  afirmações abaixo são da suíte, exceto onde está dito que a trilha mostrou.

## Cenários

### 1. Com histórico insuficiente, nenhuma sugestão é oferecida e há um motivo

Critério: "com histórico insuficiente, não produz nenhuma e diz por quê".
Sustentado por `test/suggestions-module.test.ts` ("offers nothing and says why when the
history does not repeat a pattern enough" e "does not call the model when there is no
evidence at all"): uma execução isolada não vira sugestão, a resposta traz um motivo e o
modelo não é chamado. Na trilha, três execuções completas sem um padrão que se repetisse
produziram zero sugestões. **Executado.**

### 2. O padrão precisa repetir entre execuções, acima do limiar

Critério: "só depois de um padrão repetido". Sustentado por `test/suggestions.test.ts`
(limiar por contagem e por execuções distintas, o valor de partida `{3, 2}`) e pela
trilha: linhas de auditoria e execuções repetidas produziram achados agrupados por
impressão. Na trilha, três execuções reais com a revisão devolvendo ao mesmo limite
produziram padrões de `returns`, `review-rounds` e `manual-stage` na etapa `review`,
com contagem 3 e 3 execuções distintas; nos mesmos arquivos, um padrão abaixo do limiar
não apareceu. **Executado.**

### 3. A sugestão tem as quatro partes e a etapa é existente

Critério: "sugestões com nome, papel, etapa e rascunho de prompt" com "uma etapa
existente". Sustentado por `test/suggestions-module.test.ts` ("does not propose the
model stage when it is not one of the workspace") e por `test/suggestions.test.ts`
(`stageExists`). Na trilha, a sugestão saiu com nome, papel, etapa `review` e rascunho;
a etapa oferecida ao modelo foi a lista das que existem no espaço de trabalho.
**Executado.**

### 4. A evidência está à vista e com link

Critério: "cada sugestão aparece em Ações com a evidência à vista e um link para cada
execução, mensagem ou ata". Sustentado por `test/suggestions-module.test.ts` ("leaves a
proposal in Actions for a pattern above the threshold, with the evidence and the minimum
permissions"): o cartão cita as execuções de onde saiu. A leitura monta o link da
execução a partir do endereço da issue, quando o espaço de trabalho tem um host
configurado; em espaço de trabalho sem host o link é vazio e o cartão cita a execução
pelo identificador. **Só lido** no que toca o link (a trilha rodou sem host e mostrou a
citação pelo identificador; nenhum teste afirmou o link).

### 5. As permissões propostas são as mínimas

Critério: "permissões no mínimo" e "o cartão mostra as permissões propostas".
Sustentado por `test/suggestions-module.test.ts` ("accepting creates an ordinary agent,
read only…"), que confere no agente criado permissão de leitura, sem comandos e sem
acesso ao host. Na trilha, o agente criado ficou somente leitura, sem shell, sem tracker
e sem autonomia. **Executado** para o agente criado; a linha do cartão **só lida**.

### 6. Aceitar cria um agente comum, editável e sem marca de "sugerido"

Critério: "aceitar cria um agente comum, editável, com as permissões no mínimo; o aceite
e o agente criado ficam registrados". Sustentado por `test/suggestions-module.test.ts`:
o agente entra no time sem marca de sistema, com a etapa proposta, e o registro guarda a
decisão de aceite com o identificador do agente criado. **Executado.**

### 7. Editar leva o rascunho ao editor preenchido

Critério: "editar abre o editor de agente já preenchido; salvar cria o agente". O
caminho foi corrigido nesta entrega e está guardado por `test/team-suggestion-edit.test.ts`
(cinco testes): o pedido carrega o rascunho inteiro até o painel, uma só gravação o
entrega (o defeito era a segunda gravação anulá-lo), o pedido é consumido uma vez e um
pedido que só abre aba não traz rascunho. A gravação de "editado" com o identificador do
agente está coberta em `test/suggestions-module.test.ts`. **Executado** no que a suíte
alcança; a tela renderizada **não foi exercitada** (a suíte roda sem navegador).

### 8. Recusar registra decisão, motivo, quem e quando; o cartão é marcado como pulado

Critério: "recusar registra a decisão, o motivo (quando houver), quem decidiu e quando".
Sustentado por `test/suggestions-module.test.ts` ("rejecting records the reason and skips
the proposal"). O motivo é opcional; sem motivo, o registro guarda nulo e a decisão fica
completa. **Executado.**

### 9. Uma sugestão recusada não volta sem evidência nova

Critério: "uma sugestão recusada não volta com a mesma impressão; só volta com evidência
nova, e nesse caso o cartão diz que já foi recusada, quando, e o que mudou". Sustentado
por `test/suggestions.test.ts` (impressão, chave de evidência e bloqueio) e por
`test/suggestions-module.test.ts` ("does not let the same impression come back without
new evidence, and lets it back with a new execution"). Na trilha, três execuções reais
recusadas não voltaram; uma quarta execução do mesmo feitio trouxe a sugestão de volta
com o aviso de que já havia sido recusada e a ocorrência nova citada. **Executado.**

### 10. Nada é aplicado sem a decisão da pessoa

Critério: "nenhum agente novo é criado sem uma decisão da pessoa". Sustentado por
`test/suggestions-module.test.ts` (o aceite é a única entrada que cria agente, e o
cartão nunca carrega um comando) e por `test/suggestions.test.ts` (a leitura e o registro
não escrevem nada no repositório). Na trilha, o time permaneceu intacto até o aceite.
**Executado.**

### 11. O registro fica nos dados do espaço de trabalho

Critério: "o registro da decisão fica nos dados do espaço de trabalho e não grava nada no
repositório". Sustentado por `test/suggestions.test.ts` (escrita e leitura do arquivo do
registro) e `test/suggestions-module.test.ts` (o arquivo de ações do espaço de trabalho
não guarda comando). Na trilha, o arquivo do registro ficou fora de qualquer árvore
versionada e guardou o proposto, a evidência, a decisão, o motivo, quem decidiu e quando.
**Executado.**

### 12. No fim da retro, no máximo duas sugestões

Critério: "ao fim de uma retro, no máximo duas sugestões são levantadas, e só as que
passam do limiar e não batem com uma recusa; fora desse momento e do pedido, nenhuma
sugestão é oferecida". Sustentado por `test/suggestions-module.test.ts` ("raises at most
two suggestions, and none when the conversation adds only improvements" e "raises at most
two suggestions from the retro that was answered, with the record of the squad"). A
retro é gravada antes de a leitura das sugestões acontecer, e a retro de um squad é
encontrada pelo arquivo dela. Na trilha, uma retro respondida levantou duas sugestões e
nenhuma outra; uma segunda retro, com os mesmos padrões já propostos, não levantou
nenhuma nova. **Executado.**

### 13. O botão em Configurações › Time oferece as sugestões a pedido

Critério: "a pedido, pelo botão em Configurações › Time". O botão chama o canal de
sugestão e mostra o motivo quando nada vem. A trilha chamou a mesma função que o botão
chama e recebeu as sugestões; o botão em si, na tela, **não foi exercitado** (sem
navegador). **Só lido** para o botão; **executado** para a chamada que ele faz.

### 14. A decisão é só do aplicativo de mesa

Critério: "os canais de decisão restritos à janela". Sustentado por
`test/web-server.test.ts`, que fixa a lista de canais restritos à janela: pedir, recusar
e registrar edição estão nela; a leitura do registro fica aberta. Na trilha, o cartão
nunca carregou comando, e o registro não passou pela porta de escrita externa.
**Executado.**

### 15. O gate de revisão do código não passa por escrita externa

Critério: nenhuma sugestão pode virar escrita no host de código. Sustentado por
`test/suggestions-module.test.ts` (a ação da sugestão não tem comando e o arquivo de
ações do espaço de trabalho não guarda comando) e pela leitura de `src/main/actions.ts`
(o aceite cria agente local e não chama a porta de escrita externa). **Executado** no que
a suíte cobre; a leitura confirma que o ramo novo não passa pela porta.

### 16. Os gates do repositório continuam verdes

Checagem de tipos, a suíte inteira (215 arquivos, 3569 testes), a auditoria de tema, a
checagem de idiomas (4031 chaves nos dois idiomas), a auditoria pública (865 arquivos) e
o build. Todos com saída 0 nesta etapa. **Executado.**

## Fronteiras deixadas de fora, e por quê

- **O comportamento do modelo real** ao montar a sugestão: os testes usam um modelo
  simulado e nenhuma chamada real foi feita. Não verificado.
- **O volume real do histórico** e o acerto do limiar de partida: não medidos em uso.
- **A renderização real** do cartão e do caminho "Editar": a suíte roda sem navegador.
- **O gancho do fim da retro dentro da cerimônia** (com a conversa de voz), e não só a
  função do fim da retro: a trilha chamou o fim da retro, não a cerimônia inteira.
- Duas observações herdadas da revisão, não bloqueantes e não tocadas: o aceite passa
  pelo canal de aprovação que o navegador pareado pode usar quando os efeitos externos
  estão liberados (um navegador pareado poderia criar agente local), e o cartão da
  sugestão é desenhado também no navegador pareado, onde os botões de recusar e editar
  chamam canais restritos à janela ou uma tela que não existe ali.

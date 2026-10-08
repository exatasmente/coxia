# Criar e ajustar um agente com a ajuda da IA

### O que se pede

Nas palavras de quem fez o pedido:

> podemos ajustar a config dos agentes para ter um criador de agentes com IA, baseado em um wizard interativo construído pelo LLM de acordo com a primeira resposta do humano, por exemplo quando for criar ou editar um agente, deve ter a opção de fazer com IA e a primeira parte do wizard é perguntando o que o agente deve fazer, a partir da resposta o LLM deve criar uma lista de perguntas que podem ser abertas ou de múltipla escolha (escolha única ou várias) para ir ajustando o prompt final do agente, e ter uma opção de testar o agente em uma conversa

E as decisões que a pessoa tomou no refino:

- **O que a IA preenche:** também as permissões, as ferramentas e as etapas, não só nome, papel e instruções.
- **Como se testa:** salvando o agente como rascunho e usando a conversa direta dele, com as permissões reais.
- **O assistente e os limites:** os cinco agentes de sistema ficam de fora do "Ajustar com IA" na primeira versão; a conversa do teste é apagada ao concluir; no máximo 4 rodadas, de 3 a 6 perguntas por rodada.

### O que muda para quem usa

- Em **Configurações › Time** aparece **Criar com IA**, ao lado de **Novo agente**. No editor de um agente que a pessoa criou aparece **Ajustar com IA**. Nenhum dos dois substitui o formulário: ele continua como está, e é nele que tudo termina.
- O assistente abre no painel lateral e anda por etapas:
  1. **O pedido.** Uma pergunta, em texto livre: "O que esse agente deve fazer?". Ao ajustar: "O que você quer mudar?".
  2. **Uma rodada de perguntas.** O modelo devolve de 3 a 6 perguntas, cada uma **aberta**, de **escolha única** ou de **escolha múltipla**. As de escolha trazem de 2 a 6 opções e sempre aceitam **Outro**, com texto. Cada pergunta pode ficar sem resposta. Ao lado, o rascunho (nome, papel, instruções) que muda a cada rodada.
  3. **Mais uma rodada, ou terminar.** A pessoa responde e pede a próxima rodada, ou termina quando quiser. Há no máximo 4 rodadas, e o modelo pode dizer que não tem mais o que perguntar.
  4. **A revisão.** O rascunho inteiro: nome, papel, instruções, o que o agente lê do rastreador, o que pode rodar, as ferramentas, as etapas, o squad e a quem pergunta. Cada valor acima do mínimo vem com o motivo que o modelo deu e com um botão que o devolve ao mínimo. Ao ajustar um agente, a revisão mostra o que mudou campo a campo (antes → depois).
  5. **Testar em conversa.** Salva o agente como **rascunho** e abre a conversa direta dele dentro do assistente. O que a pessoa vê de errado volta ao assistente em **Ajustar a partir desta conversa**, que leva a conversa do teste para a rodada seguinte.
  6. **Concluir.** Abre o editor de agente com o rascunho. Salvar no editor é o que põe o agente no fluxo.
- Um rascunho aparece na lista do time com a marca **Rascunho** e o botão **Descartar**. Ele não trabalha etapa nenhuma.

### Regras

1. **A IA só propõe.** O assistente produz um rascunho. Nada vira agente do time, nem muda um agente, sem a pessoa concluir e salvar no editor. A única coisa que o assistente grava antes disso é o rascunho do teste (regras 11 a 14), e esse não participa do ciclo.
2. **O modelo gera sem ferramentas.** As chamadas que escrevem perguntas e rascunhos usam o modelo do papel `deep` do workspace, com o schema da resposta e nenhuma ferramenta: não leem repositório, não leem o rastreador, não rodam comando. O que o modelo recebe é o pedido, as respostas, o rascunho até ali e o contexto do workspace que ele precisa para propor valores que existem (as etapas, os squads, os agentes do time com id e papel, o que o editor oferece neste computador).
3. **O assistente não guarda nada em disco por si.** O estado das rodadas está na tela. Fechar o painel sem concluir perde as respostas, e a única coisa que pode sobrar é um rascunho de teste (regra 14).
4. **As perguntas têm três formas.** Aberta (texto), escolha única e escolha múltipla. Cada pergunta diz, em uma linha, por que importa. As de escolha sempre aceitam **Outro** com texto. Uma pergunta sem resposta é uma pergunta que a pessoa pulou, e o modelo é avisado disso.
5. **O número de rodadas é limitado.** No máximo 4 rodadas de perguntas, de 3 a 6 por rodada. A pessoa termina quando quiser. Se o modelo responde fora da forma, as perguntas inválidas são descartadas sem perder as válidas; se não sobra nada utilizável, a tela diz isso e deixa tentar de novo ou seguir com o que existe.
6. **Língua.** As perguntas, o nome e o papel saem na língua do workspace. As instruções do agente saem em inglês, como o rascunho de prompt do #5.
7. **O rascunho cabe no editor.** Nome, papel e instruções são cortados aos limites do editor, para que o que o assistente produz sempre possa ser salvo. O id sai do nome, pelo mesmo caminho do editor (`slugOf`, `uniqueId`).
8. **Os valores propostos existem.** As permissões, as ferramentas, as etapas, o squad e o `turnsTo` só são propostos entre os valores que o editor oferece àquela pessoa, naquele computador: `sandbox` só onde há sandbox, `allowlist` só com `permission: worktree`, etapas e squad só os que o workspace tem, `turnsTo` só um agente do time que não seja ele.
9. **O que o modelo nunca decide.** `shell: host`, `autonomous`, `allowedCommands`, o modelo do agente (fica o do papel `deep`, como em todo agente novo) e o id. `host` é "só no computador, nunca trazido por um modelo" (`src/shared/config/types.ts:505`), e a autonomia e os comandos sempre permitidos são decisões da pessoa, uma a uma, no editor.
10. **Cada valor acima do mínimo é visível e reversível.** O mínimo é o de um agente novo: só lê, sem rastreador, sem comandos, sem ferramentas próprias, sem etapas, compartilhado, pergunta à pessoa. A revisão lista o que passa do mínimo, com o motivo, e a pessoa devolve cada campo ao mínimo com um clique antes de concluir ou de testar.
11. **O teste usa um rascunho salvo.** Para testar, o app salva o agente no time com a marca de rascunho e abre a conversa direta dele (`agent-<id>`, #71) dentro do assistente. Ao ajustar um agente que já existe, o teste é de uma **cópia** em rascunho com as mudanças; o original não muda até a pessoa concluir.
12. **O rascunho não faz parte do ciclo.** Ele nasce com `stages` vazio, sem squad, `autonomous: false` e `turnsTo: null`. Isso é o que decide o lugar do agente no fluxo, e só vale quando a pessoa conclui. Um rascunho não é escolhido para trabalhar uma etapa, não aparece como opção de "pergunta a" de outro agente, não é chamado por outro agente numa conversa, e não entra nas checagens do fluxo e dos squads como agente de uma etapa. As permissões, as ferramentas e as instruções valem desde o primeiro teste: é isso que se testa.
13. **O teste tem as permissões do agente, e nada mais.** O que o agente propõe no rastreador espera em Ações como sempre; um comando espera o "sim" da pessoa como sempre; um workspace de teste recusa toda escrita como sempre. Como o rascunho nasce não autônomo, nada sai sozinho durante o teste.
14. **O rascunho se limpa.** Descartar o assistente apaga o rascunho de teste e a conversa dele. **Concluir** apaga só a conversa do teste: o rascunho fica no time e vira o agente quando a pessoa salva no editor, que então começa com a conversa direta vazia; cancelar o editor volta ao assistente, com as respostas e o rascunho intactos. Um rascunho que sobrou (o app fechou no meio) fica na lista do time com a marca e o botão **Descartar**; descartar apaga o agente e a conversa e é uma ação da pessoa, com confirmação.
15. **O editor continua sendo o portão.** **Concluir** abre o editor com o rascunho; tudo o que o editor recusa (nome vazio, id tomado, `allowlist` num agente que não escreve, os problemas do fluxo e do squad) o assistente não contorna. Ao ajustar um agente, o editor abre no agente original com as mudanças ainda não salvas.
16. **Só no computador.** As chamadas do assistente gastam o modelo e criam agente com permissões; ficam fora do telefone pareado, como `suggestions:suggest` (`src/main/webPolicy.ts:12`).
17. **O que falha é dito.** Provedor sem chave ou sem orçamento, resposta vazia, erro do engine: a tela diz o motivo e deixa tentar de novo, como as outras chamadas do app.
18. **O que já funciona não muda.** O formulário em branco, **Sugerir agentes** (#5), a conversa direta (#71), as permissões por agente e o `Recomendado` ficam como estão.

### Fora do escopo

- **Ajustar os cinco agentes de sistema com a IA.** O papel e as instruções deles espelham `agents.roles` e as cerimônias leem isso; ficam para depois.
- **Escolher o modelo ou o provedor do agente pela IA.** O agente novo pega o modelo do papel `deep`; a pessoa troca no editor.
- **A IA decidir `shell: host`, autonomia ou comandos sempre permitidos.**
- **Criar vários agentes de uma vez, um time inteiro ou mexer no fluxo** (criar, remover ou reordenar etapas). O agente aponta para etapas que já existem.
- **Retomar um assistente interrompido** ou guardar o histórico das perguntas e respostas.
- **O assistente no telefone pareado.**
- **Testar o agente numa execução real**, num canal ou na conversa geral. O teste é a conversa direta dele.
- **Exportar o agente como modelo** ou compartilhá-lo.
- **Empacotar o Claude Agent SDK** (`npm run dist`), como sempre.

### Critérios de aceite

1. Em Configurações › Time há **Criar com IA**; no editor de um agente criado pela pessoa há **Ajustar com IA**; nos cinco agentes de sistema não há.
2. A primeira etapa pergunta o que o agente deve fazer, e a resposta dela gera uma rodada de 3 a 6 perguntas, cada uma aberta, de escolha única ou de escolha múltipla, e as de escolha aceitam **Outro**.
3. Responder e pedir outra rodada refina o rascunho; a prévia do prompt muda a cada rodada; a pessoa termina quando quiser; a quinta rodada não existe.
4. Uma resposta do modelo com perguntas fora da forma não derruba a rodada: as válidas aparecem; sem nenhuma válida, a tela diz isso e deixa tentar de novo.
5. A revisão mostra nome, papel, instruções, permissões, ferramentas, etapas, squad e `turnsTo`; cada valor acima do mínimo traz um motivo e volta ao mínimo com um clique. Nenhuma revisão traz `host`, autonomia, comando permitido ou modelo próprio.
6. Nenhum valor proposto é um que o editor não oferece: `sandbox` sem sandbox, `allowlist` num agente que só lê, uma etapa ou um squad que não existem.
7. **Testar em conversa** salva um rascunho com `stages` vazio, sem squad, `autonomous: false` e `turnsTo: null`, e abre a conversa direta dele; o rascunho aparece na lista do time com a marca **Rascunho**.
8. Com um rascunho no time, nenhuma execução o escolhe para uma etapa, ele não é opção de `turnsTo`, `CallAgent` não o alcança e `checkFlow` não o conta como agente de uma etapa.
9. No teste, uma proposta de escrita do agente espera em Ações; um comando espera o "sim"; num workspace de teste a confirmação é recusada.
10. **Ajustar a partir desta conversa** leva a conversa do teste para a rodada seguinte, e o rascunho salvo acompanha o novo rascunho.
11. Ao ajustar um agente existente, o teste é de uma cópia: o agente original não muda até a pessoa salvar no editor.
12. **Concluir** abre o editor preenchido; salvar tira a marca de rascunho, aplica etapas, squad e `turnsTo`, e o agente tem a conversa direta vazia. Descartar o assistente apaga o rascunho e a conversa.
13. Um rascunho que sobrou de um app fechado aparece com a marca e **Descartar**, com confirmação, e descartar apaga o agente e a conversa.
14. Nome, papel e instruções propostos cabem nos limites do editor; um nome gerado nunca faz o salvar falhar.
15. As chamadas do assistente não funcionam no telefone pareado.
16. Sem chave ou sem orçamento do provedor, o assistente diz o motivo e deixa tentar de novo.
17. **Novo agente** em branco, **Sugerir agentes** e a conversa direta continuam como antes.
18. Cancelar o editor aberto por **Concluir** volta ao assistente com as respostas e o rascunho intactos; o rascunho só deixa de existir quando a pessoa salva no editor ou descarta o assistente.

### Como foi conferido

Nesta etapa o código foi lido; nada foi executado e nada foi visto funcionando no aplicativo.

- **O editor já abre preenchido.** `TeamSection` recebe `suggestion` e abre o `AgentPanel` com o rascunho e `isNew: true` (`src/renderer/src/screens/team/TeamSection.tsx:27`, o efeito logo abaixo); o botão de agente em branco é `:76`. O rascunho é um `AgentDraft` (`src/renderer/src/screens/team/agentEdit.ts:13`), e o que o editor recusa vem de `agentProblems` (`:84`) e `teamIssues` (`:128`); `applyAgent` (`:105`) faz a única passagem de rascunho para config.
- **Os limites do editor.** Nome 100, papel 1000 e instruções 4000 caracteres (`TeamSection.tsx:179`, `:196`, `:199`). O esquema aceita nome de até 80 (`src/shared/config/schema.ts:221`), papel até 2000 e instruções até 20 000. **Descompasso que o plano precisa tratar:** o editor deixa digitar um nome de 81 a 100 caracteres que o esquema recusa; o assistente corta o nome em 80, o mais estrito dos dois. Não verifiquei, rodando, que o salvar falha nesse caso.
- **Uma chamada estruturada ao modelo, sem estado.** `askAgent` é `run` (`src/main/agents.ts:1266`, `:765`) e o sugeridor a usa com o papel `deep` e um schema (`src/main/suggestionsModule.ts:107`). Pelo caminho de cerimônia, a chamada do papel leva as ferramentas de leitura do papel (`runOnce`, `agents.ts:743-761`); a retomada de uma chamada sem turnos passa `tools: []` e `allowedTools: []` (`:796`). **O plano precisa mostrar que a chamada do assistente sai sem ferramenta nos dois engines**; hoje só li o caso da retomada.
- **A conversa direta.** O tipo `agent` existe (`src/shared/forum.ts:115`), com id `agent-<id>` (`:174`). A thread é criada quando o fórum é listado: `ensureAgentThread` (`src/main/forum-channels.ts:19`), chamada por `forum:list` para cada agente do time (`src/main/forum.ts:99`). O dono responde sem `@` (`callsOf`/`ownerOfThread`, `src/main/mentions/module.ts:38`, `:45`). A tela do fórum monta a conversa com o componente `Thread` (`src/renderer/src/screens/cycle/ForumScreen.tsx:136`), que o assistente pode reaproveitar. **O assistente precisa garantir a thread** do rascunho, porque ela só nasce quando alguém lista o fórum.
- **Apagar uma conversa.** O armazém do fórum só remove uma mensagem por vez (`remove(thread, seq)`, `src/main/forum-core.ts:61`, `:382-390`); não há apagar uma thread. `removeAgent` só mexe na config (`src/shared/config/team.ts:117`) e não toca na thread: hoje, remover qualquer agente deixa `agent-<id>` órfã. **Apagar a conversa do rascunho é uma capacidade nova do armazém.**
- **Por que um rascunho não pode listar etapas.** `stageAgent` devolve, para uma etapa sem agente nomeado, "o primeiro agente do time que lista a etapa" (`src/shared/config/team.ts:71`); é lido pelo desenho do fluxo (`src/shared/runs/flow.ts:34`, `:91`) e pela checagem do fluxo (`src/shared/runs/flowCheck.ts:70`). Um rascunho salvo com etapas assumiria o lugar de um agente numa execução real.
- **Quem lê o time.** As opções de `turnsTo` (`agentEdit.ts:169`), a lista de quem uma conversa pode chamar com `CallAgent` (`src/main/mentions/answer.ts:208`) e as menções (`parseMentions`, `src/shared/forum.ts:186`) leem `agents.team`. O plano precisa filtrar o rascunho em cada um desses lugares.
- **O agente não escreve em arquivo numa conversa.** Uma menção nunca recebe Edit ou Write, qualquer que seja a permissão do agente (`src/main/mentions/call.ts`, comentário de topo; `src/main/agents.ts:1136-1139`). Por isso `permission: worktree` num rascunho não muda o que o teste consegue fazer em arquivos.
- **As propostas de escrita de uma conversa** seguem a permissão de leitura do rastreador do agente (`src/main/mentions/answer.ts:120`), e um comando de agente em `host` pede o "sim" pelo aviso do app (`src/main/mentions/module.ts:58`).
- **O que o esquema diz de um campo novo.** `agentDef` (`src/shared/config/schema.ts:217`) lista os campos de um agente; um campo `draft` seria novo ali, e a cadeia de versões do esquema e a recusa de "escrito por um app mais novo" estão em `src/shared/config/migrations.ts:351-368` e `validate.ts:306`. **Decisão do plano, com a rule `config-schema.md`:** se um campo opcional novo exige subir a versão.
- **Desktop apenas.** `suggestions:suggest` está em `DESKTOP_ONLY` (`src/main/webPolicy.ts:12`); os canais do assistente entram ali.

Não verificado nesta etapa (não lido): como o assistente fica no painel lateral em largura de telefone (a tela do time na janela estreita); o custo de uma rodada em tokens; se os dois engines devolvem uma resposta estruturada do tamanho de uma rodada sem ferramenta; a contagem do uso dessas chamadas na tela de uso. Nenhuma chamada de modelo foi exercitada.

### Prioridade e marco propostos

- **Prioridade: P2.** Motivo: tira atrito de uma tarefa que a pessoa faz de vez em quando e que hoje se faz à mão, sem perder dado e sem tocar numa fronteira de segurança. Sobe para P1 se a criação de agentes for o principal caminho de adoção do ciclo de agentes.
- **Marco: a próxima versão menor.** No gate 2 a pessoa escolheu a 0.8.0, em beta; a 0.8.0 estável foi lançada em 2026-10-08, durante a implementação, e a `release/0.8.0` deixou de existir. O trabalho passou a partir da `main` e entra na versão seguinte. O esquema da configuração sobe de 18 para 19 ali: quem salvar com a build nova não volta à anterior.

### Decisões do refino

Eram perguntas em aberto; a pessoa aprovou a spec aceitando a recomendação de cada uma:

1. **A conversa do teste é apagada ao concluir.** O agente que a pessoa salva começa com a conversa direta vazia (regra 14).
2. **Os cinco agentes de sistema ficam de fora do "Ajustar com IA"** na primeira versão (fora do escopo).
3. **No máximo 4 rodadas, de 3 a 6 perguntas por rodada** (regra 5).

### Decisões do gate 2 (o plano)

Respostas da pessoa ao plano técnico; as três primeiras foram contra a recomendação do plano:

4. **O assistente pode propor `permission: worktree`**, com motivo e botão de voltar como qualquer valor acima do mínimo. Uma conversa nunca escreve em arquivo, então o teste não mostra o que o agente faz com isso, e a revisão diz isso ao lado do valor (regras 8 e 10).
5. **Concluir mantém o rascunho no time até a pessoa salvar no editor**; cancelar o editor volta ao assistente (regra 14, critério 18).
6. **O trabalho entraria na 0.8.0, em beta.** A 0.8.0 foi lançada durante a implementação; ele entra na versão menor seguinte (marco acima).
7. **A tela de Custo e a limpeza de transcrições contam as chamadas do assistente.**

### Perguntas para o plano técnico, não para a pessoa

- Como marcar o rascunho (campo opcional `draft` no `agentDef`, com a decisão sobre a versão do esquema) e onde filtrá-lo.
- Como o app apaga uma thread inteira, e se a thread órfã que `removeAgent` deixa hoje entra no mesmo conserto.
- Como a chamada do assistente sai sem ferramenta nos dois engines, e como o uso aparece.
- O formato do schema das perguntas e do que o modelo devolve, e o leitor leniente que descarta o que está fora da forma (como `readProposedWrites`, `src/main/mentions/call.ts`).
- O canal que cria e atualiza o rascunho, e o que o `Thread` precisa para ser embutido no painel.

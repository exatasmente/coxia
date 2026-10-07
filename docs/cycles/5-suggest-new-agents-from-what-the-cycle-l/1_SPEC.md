# O time aprende com o ciclo e propõe um agente novo

## O problema

O aplicativo não percebe que uma etapa vem sendo feita à mão, que o mesmo tipo de pergunta
volta, ou que um passo repetido poderia ser um agente próprio. A forma do time é a que foi
configurada uma vez e não aprende.

## O que esta mudança entrega

- O aplicativo examina o histórico que já grava e, quando encontra um padrão repetido que
  se lê como "isto poderia ser um agente", monta uma sugestão: um nome, um papel, a etapa
  que esse agente cobriria e um rascunho de prompt.
- A sugestão aparece como uma proposta em Ações, com a evidência que a produziu à vista, e
  passa por **aceitar, editar ou recusar**. Nenhuma sugestão existe sem evidência, e nada é
  aplicado em silêncio.
- A decisão fica registrada: uma sugestão recusada não volta igual.
- Aceitar cria um agente comum do time, que a pessoa edita depois como qualquer outro.

## O que muda para quem usa

- Em **Configurações › Time** existe o botão **Sugerir agentes**. Ele pede ao aplicativo que
  leia o histórico do ciclo naquele momento e monte as sugestões que a evidência sustentar
  (nenhuma, uma ou várias).
- Ao fim de uma **retro**, o aplicativo pode, por conta própria, levantar até **duas**
  sugestões, e só quando a evidência passa do limiar e não bate com uma recusa anterior.
  Fora desses dois momentos — o pedido e o fim da retro — nenhuma sugestão é oferecida; nunca
  no meio de uma execução nem no meio de uma cerimônia.
- Cada sugestão vira um cartão em **Ações** com o nome, o papel, a etapa, o rascunho do
  prompt, as permissões propostas e a evidência, com um link para cada execução, mensagem ou
  ata de onde ela saiu. Dá para ler tudo antes de decidir.
- Três caminhos, no cartão:
  - **Aceitar** cria um agente comum no time, editável como os outros.
  - **Editar** abre o editor de agente em Configurações › Time já preenchido com o que a
    sugestão propunha; salvar cria o agente.
  - **Recusar** pede um motivo, que é opcional, e o motivo fica no registro.
- O histórico da decisão fica guardado nos dados do espaço de trabalho — nunca no
  repositório, que é público — e diz o que foi proposto, a evidência, a decisão, quem decidiu
  e quando. Uma recusa guarda a "impressão" da sugestão; a mesma impressão só reaparece quando
  há evidência nova que a recusa não viu, e nesse caso o cartão diz que a sugestão já foi
  recusada antes, quando, e o que mudou.

## Regras

1. **Fonte é o histórico que já existe.** A sugestão é derivada apenas do que o aplicativo já
   grava; a primeira versão não passa a gravar nada novo para alimentá-la. As fontes são:
   - **execuções** — perguntas que chegaram à pessoa (`needs-person`) sobre o mesmo tema em
     execuções diferentes; devoluções repetidas para a mesma etapa pelo mesmo motivo; rodadas
     de revisão e cenários de QA que repetem o mesmo tipo de achado; etapas que a pessoa
     assumiu à mão (pulou, refez ou respondeu no lugar do agente);
   - **comandos permitidos** — o mesmo comando que a pessoa permite de novo e de novo, lido
     como um passo manual repetido;
   - **cerimônias** — as decisões e as atas, e as melhorias que a retro levanta.
2. **Sem evidência, não há sugestão.** Toda sugestão cita a evidência que a produziu, com um
   link para cada execução, mensagem ou ata. Não há sugestão baseada em impressão geral.
3. **Só depois de um padrão repetido.** Uma ocorrência isolada não basta: a sugestão nasce de
   um padrão que se repete no histórico (o mesmo tema, o mesmo motivo, o mesmo tipo de achado,
   o mesmo comando), acima de um limiar. Abaixo do limiar, nada é oferecido.
4. **A sugestão tem quatro partes.** Nome, papel, a etapa que o agente cobriria e um rascunho
   de prompt. A etapa proposta é uma etapa existente do fluxo do espaço de trabalho.
5. **Permissões no mínimo.** A sugestão nasce somente leitura e sem comandos. Nada acima
   disso é proposto, e o cartão mostra as permissões propostas.
6. **Nada é aplicado em silêncio.** A sugestão só vira agente pela decisão da pessoa; nenhum
   agente novo é criado sozinho.
7. **A decisão é registrada e dura.** O registro fica nos dados do espaço de trabalho, sem
   prazo, com o proposto (papel, etapa, prompt), a evidência, a decisão, quem decidiu e quando.
   O aceite fica registrado junto do agente que a sugestão criou.
8. **Recusa não volta igual.** A recusa guarda a impressão da sugestão (papel + etapa + tipo de
   evidência). A mesma impressão só volta se houver evidência nova que a recusa não viu; ao
   voltar, a proposta diz que já foi recusada, quando, e o que mudou. O motivo da recusa, quando
   houver, fica no registro.
9. **Aceitar cria um agente comum.** O agente criado entra no time como qualquer outro:
   editável, com etapa, permissões e os demais campos, e sem marca de "sugerido".
10. **Quando é oferecida.** A pedido, pelo botão em Configurações › Time, quantas sugestões a
    evidência sustentar; e por conta própria, só ao fim de uma retro, no máximo duas. Nunca no
    meio de uma execução nem de uma cerimônia.
11. **A transcrição completa das cerimônias fica para depois.** Esta mudança lê as decisões e
    as atas, não a transcrição inteira.

## Fora do escopo

- Gravar história nova para alimentar a sugestão: a primeira versão lê só o que já existe. Se
  alguma fonte não é legível hoje, ela fica de fora até haver um registro dela.
- Ler a transcrição completa das cerimônias.
- Mudar o fluxo do espaço de trabalho (criar, remover ou reordenar etapas) a partir de uma
  sugestão: a sugestão aponta para uma etapa existente.
- Sugerir mudanças numa etapa existente, ou sugerir a remoção de um agente.
- Aplicar qualquer permissão acima do mínimo (comandos, sandbox, host) sem a pessoa editar
  depois.
- Agir por conta própria no meio de uma execução ou de uma cerimônia.
- Levar as melhorias de processo da retro adiante como tarefa: isso é da issue própria desse
  item, e não desta mudança.
- Aprovar ou recusar a sugestão por qualquer caminho que não seja a decisão da pessoa em Ações.

## Aceitação

- Em Configurações › Time, o botão **Sugerir agentes** produz, a partir do histórico gravado,
  sugestões com nome, papel, etapa e rascunho de prompt; com histórico insuficiente, não
  produz nenhuma e diz por quê.
- Cada sugestão aparece em Ações com a evidência à vista e um link para cada execução, mensagem
  ou ata de onde saiu; nenhuma sugestão aparece sem evidência.
- Aceitar cria um agente comum, editável, com as permissões no mínimo; o aceite e o agente
  criado ficam registrados.
- Editar abre o editor de agente em Configurações › Time já preenchido; salvar cria o agente.
- Recusar registra a decisão, o motivo (quando houver), quem decidiu e quando.
- Uma sugestão recusada não volta com a mesma impressão; só volta com evidência nova, e nesse
  caso o cartão diz que já foi recusada, quando, e o que mudou.
- Ao fim de uma retro, no máximo duas sugestões são levantadas, e só as que passam do limiar e
  não batem com uma recusa; fora desse momento e do pedido, nenhuma sugestão é oferecida.
- O registro da decisão fica nos dados do espaço de trabalho e não grava nada no repositório.
- Nenhum agente novo é criado sem uma decisão da pessoa.

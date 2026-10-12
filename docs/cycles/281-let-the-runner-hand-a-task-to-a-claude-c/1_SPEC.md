# Entregar a tarefa de uma etapa a uma sessão do Claude Code

## O que muda para quem usa

- Cada etapa do fluxo ganha o campo **Executor**, com duas opções: "Agente do Coxia" (padrão, o comportamento de hoje) e "Sessão do Claude Code". Quem não mexe no campo não vê nenhuma mudança.
- Há uma opção global, **"Entregar tarefas ao Claude Code"**, desligada por padrão e disponível só no desktop. O campo Executor só aparece, e só pode ser escolhido, com ela ligada.
- Uma etapa com executor "Sessão do Claude Code" entrega a tarefa a uma sessão do Claude Code na máquina e usa o resultado dessa sessão como a resposta da etapa. O resto do ciclo (veredito, documentos, etapas seguintes) lê essa resposta como lê a de qualquer agente.
- A conversa completa da sessão fica guardada como registro da etapa, fora da resposta.
- Se a sessão pede permissão para algo, o pedido chega à pessoa como item pendente e a etapa espera a resposta.

## Regras

1. O executor padrão de toda etapa é "Agente do Coxia"; fluxos existentes continuam iguais.
2. A primeira versão aceita o executor "Sessão do Claude Code" em qualquer etapa que tenha agente.
3. A opção global vem desligada, vale só no desktop e só a pessoa, no desktop, liga ou desliga. Celular pareado e persona não ligam a opção nem escolhem o executor.
4. Com a opção desligada, nenhuma etapa alcança uma sessão do Claude Code. Se uma etapa estiver configurada com o executor Claude Code, a execução recusa com mensagem clara e **não** cai no agente do Coxia.
5. Em workspace com `test: true` a entrega é sempre recusada, com mensagem clara, mesmo com a opção ligada.
6. O resultado da sessão **substitui** a resposta da etapa; não é anexo.
7. Sessão que termina sem resultado, ou com erro, faz a etapa falhar como falha qualquer agente.
8. Todo pedido de permissão da sessão vira item pendente para a pessoa; a etapa fica esperando até a resposta.
9. Escrita fora da pasta de trabalho da execução é recusada.
10. O caminho vai do Coxia para o Claude Code; o servidor `coxia-state` não é a via.
11. Nada do `~/.claude` da pessoa entra em testes ou dados de exemplo.
12. A entrega depende da entrega de sessões do Claude Code (#280): sem ela, esta não funciona.

## Fora do escopo

- Sessões com Remote Control (#282) e a listagem/condução de sessões em si (#280).
- Anexar o resultado da sessão em vez de substituí-lo.
- Escolher a sessão por etapa além do executor (retomar, bifurcar uma sessão existente): não pedido.
- Escolher o mecanismo técnico (ACP ou Agent SDK), como o limite de escrita é imposto e o formato do campo no esquema do fluxo: decisões do plano.

## Critérios de aceite

1. **Resultado de volta.** Com a opção ligada e uma etapa com executor "Sessão do Claude Code", rodar o ciclo até essa etapa: a etapa conclui e a resposta mostrada é o resultado da sessão; a etapa seguinte o recebe como entrada.
2. **Registro.** Abrir a etapa concluída: a transcrição da sessão está disponível como detalhe e não aparece dentro da resposta.
3. **Permissão.** Fazer a sessão pedir uma permissão: aparece um item pendente para a pessoa e a etapa continua em espera. Responder libera a etapa; recusar é respeitado pela sessão.
4. **Escrita fora do worktree.** Fazer a sessão tentar escrever fora da pasta de trabalho da execução: a escrita é recusada e nenhum arquivo aparece fora dela.
5. **Opção desligada.** Com a opção desligada: o campo Executor não aparece (ou não pode ser escolhido); uma etapa já configurada com Claude Code falha com mensagem clara e nenhuma sessão é iniciada, nem o agente do Coxia roda no lugar.
6. **Workspace de teste.** Em workspace `test: true`, mesmo com a opção ligada, a etapa recusa com mensagem clara e nenhuma sessão é iniciada.
7. **Celular e persona.** No celular pareado e pela persona, não é possível ligar a opção nem escolher o executor; a tentativa é negada.
8. **Falha da sessão.** Sessão que encerra com erro ou sem resultado: a etapa aparece como falha, como a de um agente que falha.
9. **Padrão intacto.** Etapa sem o campo alterado roda com o agente do Coxia exatamente como antes.
10. **Testes.** Os testes dessa entrega usam sessões simuladas e não tocam `~/.claude`.

## Perguntas em aberto

Nenhuma que bloqueie. Para o plano: ACP ou Agent SDK, como impor o limite de escrita, o formato do campo no esquema do fluxo e o encaixe com os canais de sessões da #280 (estado dessa dependência não verificado nesta etapa).

## O que foi verificado

Leitura da issue, da triagem e da conversa. No código, só que a etapa do fluxo hoje não tem campo de executor (campo novo); a busca por um módulo de sessões da #280 nesta worktree não encontrou nada. Nada foi executado.

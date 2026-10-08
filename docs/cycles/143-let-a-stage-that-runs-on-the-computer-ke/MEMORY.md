# Memória do ciclo

## Decisões

- Triagem da #143: **bug**, confirmada por leitura de código. Entende-se como está escrita; nada falta a quem abriu. Virada de memória a partir do ciclo da #142: nada de decisão de produto foi tomado aqui além do tipo, do entendimento e da sugestão de prioridade.
- **Tipo e escopo:** a issue é o mesmo problema da #142 num outro modo de execução, o `shell: host`, que a #142 deixa de fora por decisão própria. Não é duplicata: é um pedaço declarado que a #142 não entrega. A #143 depende da #142 estar mesclada (as duas mexem no mesmo arquivo do executor).
- **Verificado por leitura** (o que o código mostra hoje): as ferramentas de comprovação só são oferecidas com `session?.stageDir && d.keepEvidence`, e é a mesma condição que monta as ferramentas, as desliga no esquema (a saída cita ids) e acrescenta a regra de comprovação ao prompt; a sessão de host não devolve pasta de etapa; o fecho dela remove a pasta temporária inteira; o texto que a etapa recebe e a descrição da ferramenta de comprovação falam de `/coxia/out` fixo, que não existe no host; a resolução de caminho tem raiz fixa `<pasta de etapa>/out`; a guarda do fecho da #142 roda logo antes de `session?.close()`.
- **Não verificado nesta etapa:** o comportamento do modo host não foi exercitado (nenhum comando, nenhum run, nenhuma tela); a execução real citada pela issue não foi refeita; o caminho de uma etapa de host que roda de novo sobre uma comprovação já guardada não foi lido.
- **Sugestão de prioridade:** a mais alta dos níveis configurados (a issue já veio com `priority:high`). Nenhum marco proposto.

## Restrições

- Tudo o que está dito como existente foi **lido em arquivo nesta cópia**; o que não foi lido está marcado como não verificado. Nada foi executado.
- A entrega do ciclo começa depois da #142 mesclada: as duas mudam a mesma fiação de comprovação em `src/main/runner/executor.ts`.
- A guarda da imagem olhada e não guardada só lê caminho dentro da pasta de saída da etapa; o tipo continua sendo lido do conteúdo e o teto de tamanho continua valendo.
- A conferência pública e as regras do repositório valem para tudo o que este ciclo escrever (sem nome real, host, número de issue ou credencial).
- Nada foi decidido sobre como o host expõe a pasta de saída, nem sobre o que conta como "testar uma interface" no host: são decisões do refino.

## Tentado e descartado

- Perguntar ao repórter: descartado na triagem; a issue traz o que viu, onde no código e a aceitação item por item.
- Tratar a #143 como duplicata da #142: descartado; a #142 exclui o host de propósito, e as duas têm aceitação própria.
- Escrever a nota de lançamento nesta etapa: descartado; o pedido de mudança visível ao usuário mora no arquivo de mudanças do repositório, e é trabalho da etapa que implementa ou do fecho do ciclo, não desta etapa — não é documento do ciclo.

## Perguntas abertas

- Nenhuma bloqueante para o refino. **Não verificado:** o comportamento do modo host; o caminho de uma etapa de host que roda de novo sobre comprovação já guardada; a corrida da suíte nesta cópia (nenhum comando foi rodado nesta etapa).
- **Sugestões não decididas, para o refino:** (1) como disponibilizar a pasta de saída do host para as ferramentas de comprovação — reaproveitar a pasta de etapa que a sandbox já usa, ou ligar as ferramentas à pasta criada pelo host; (2) o que conta como "testar uma interface" no host, já que a pasta de saída só nasce com navegadores ou tela virtual ligados, e ligá-la sem eles muda o prompt de uma etapa que hoje não a tem.

## Onde o trabalho está

- Esta etapa entrega só o `0_TRIAGE.md`, na pasta do ciclo `docs/cycles/[redacted]`. Nada foi mudado no código, e nenhum documento da #142 pertence a este ciclo.
- Passagem triagem → refinamento: o tipo é bug, entende-se como está escrita, e as duas decisões de desenho a fixar na especificação estão listadas em "Perguntas abertas".
- O restante da pasta (memória, issue, documentos das etapas seguintes) nasce com as próximas etapas.

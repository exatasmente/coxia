# Memória do ciclo

## Decisões

- A issue foi classificada como **pedido de funcionalidade** (`enhancement`), não bug, não pergunta, e nenhuma issue a duplica.
- Nenhuma pergunta foi publicada na issue: a triagem não achou nada que só quem abriu possa dizer. A issue já traz o comportamento esperado, o aceite item por item, o que fica de fora e a nota de que a solução fica para o refinamento e o planejamento.
- Prioridade sugerida no `0_TRIAGE.md` como `priority:medium` (três frentes independentes, uma migração de configuração e uma regra de segurança mexida; nada quebrado). **É sugestão, não decisão** — a prioridade e o marco são da etapa de refinamento do produto.
- O trabalho **não foi fatatiado** pela triagem. A separação mais natural (a rede `open` sozinha, por ser a mais barata e destravar testes que hoje não rodam na sandbox) ficou registrada como sugestão de corte, não como decisão.

## Restrições

## Tentado e descartado

- Perguntar a quem abriu sobre a rede da sandbox e a resolução de nomes. Descartado: a issue já diz que a configuração do resolvedor costuma ser um link fora de `/etc`, e o problema é de desenho, não de relato.
- Perguntar a quem abriu se o interruptor de push e pull request alcança uma execução de release. Descartado: é escopo, que é decisão da pessoa na hora certa, e o refinamento é quem propõe; a contradição com a decisão D18 ficou registrada na triagem para o refinamento resolver.
- Tratar como duplicata qualquer uma das issues do mesmo território (permissões dos agentes e a sandbox, memória do ciclo, o runner e a pasta do ciclo, o processo de release). Descartado: cada uma define regras que esta issue estende ou move, nenhuma pede o mesmo comportamento.

## Perguntas abertas

- Se o interruptor de push e pull request alcança uma execução de **release**: a decisão D18 manda os cortes e os envios (`beta`, `stable`, `push-branch`, `push-tag`) esperarem sempre o sim, mesmo com o agente autônomo, porque rodam o script do repositório como a pessoa e sem sandbox. Não é pergunta de quem abriu nem da triagem; o refinamento decide e registra.
- Se o novo interruptor substitui ou convive com a chave `autonomous` de cada agente, que a issue mantém como está ("qualquer que seja o `autonomous` de cada agente"). Do refinamento.
- O que o aplicativo mostra quando um agente autônomo roda um comando `host` sem a pergunta: a pergunta do comando já tem uma recusa com o seu próprio texto e a frase da pessoa que negou. Do refinamento.

## Onde o trabalho está

Etapa de triagem concluída. `0_TRIAGE.md` escrito na pasta do ciclo, com o tipo, a conferência por leitura do que a issue afirma (com arquivo e linha), o que falta (nada), as issues relacionadas, os pontos exatos da documentação onde a regra de hoje muda, a sugestão de prioridade e a ressalva de que nada foi executado. Nenhum código e nenhum outro documento foram tocados. A próxima etapa é o refinamento do produto.

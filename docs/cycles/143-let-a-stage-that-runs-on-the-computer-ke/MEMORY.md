# Memória do ciclo

## Decisões

- Triagem da #143: **bug**, confirmada por leitura de código. Entende-se como está escrita; nada falta a quem abriu.
- **Tipo e escopo:** a issue é o mesmo problema da #142 num outro modo de execução, o `shell: host`, que a #142 deixa de fora por decisão própria. Não é duplicata: é um pedaço declarado que a #142 não entrega. A #143 depende da #142 estar mesclada (as duas mexem no mesmo ponto do executor).
- **Verificado por leitura** (o que o código mostra hoje): as ferramentas de comprovação só são oferecidas com `session?.stageDir && d.keepEvidence`, e é a mesma condição que monta as ferramentas, as desliga no esquema (a saída cita ids) e acrescenta a regra de comprovação ao prompt; a sessão de host não devolve pasta de etapa e só cria pasta de saída quando recebe navegadores ou tela virtual (`gui.out`), sendo que a descrição de `ViewImage` já sabe nomear essa pasta; o texto que a etapa recebe e a descrição da ferramenta de comprovação falam de `/coxia/out` fixo, que não existe no host; a resolução de caminho tem raiz fixa `<pasta de etapa>/out`; a guarda do fecho da #142 roda logo antes de `session?.close()`; a leitura de imagem da pasta do host passa pela sessão (`readImage`), e o gancho "olhado" não é alimentado nesse caminho.
- **Refino — D1:** a comprovação de uma etapa de host é lida da **própria pasta de saída que a sessão cria** (a que o prompt apresenta em `COXIA_OUT` e que `ViewImage` já conhece), não de uma pasta de etapa nova. Assim uma etapa de host sem teste de interface continua sem pasta, e a pasta temporária continua sendo a origem de onde se guarda, não a raiz permanente.
- **Refino — D2:** "testar uma interface" numa etapa de host continua sendo **exatamente a condição de hoje** — pasta de navegadores disponível ou tela virtual pedida. Nada de critério novo; ligar a pasta de saída sem nenhuma das duas daria ferramenta e texto novos a uma etapa que hoje não os tem.
- **Sugestão de prioridade:** a mais alta dos níveis configurados (a issue já veio com `priority:high`), mantida no refino. Nenhum marco proposto.

## Restrições

- Tudo o que está dito como existente foi **lido em arquivo nesta cópia**; o que não foi lido está marcado como não verificado. Nada foi executado em nenhuma etapa até aqui.
- A entrega começa depois da #142 mesclada: as duas mudam a mesma fiação de comprovação no executor. Se a #142 não estiver na base, a implementação precisa dizer isso.
- As regras da comprovação (só dentro da pasta de saída, sem `..`, sem link, tipo lido dos bytes, teto de tamanho, ids `ev-<n>`) valem iguais nos dois modos e não mudam para a sandbox.
- O que entra na execução são só ids que a própria execução conhece; a escolha de onde a comprovação fica (dados do app, ou também a pasta do ciclo no commit da etapa) vale igual para o host.
- A conferência pública e as regras do repositório valem para tudo o que este ciclo escrever (sem nome real, host, número de issue ou credencial).

## Tentado e descartado

- Perguntar ao repórter: descartado na triagem; a issue traz o que viu, onde no código e a aceitação item por item.
- Tratar a #143 como duplicata da #142: descartado; a #142 exclui o host de propósito, e as duas têm aceitação própria.
- Escrever a nota de lançamento como documento desta etapa: descartado; o pedido de mudança visível ao usuário mora no `CHANGELOG.md` do repositório, sob `## [Unreleased]`, e é trabalho da etapa que implementa ou do fecho do ciclo.
- Criar uma pasta de etapa para o host só para a comprovação (reaproveitar a pasta da sandbox): descartado no refino (D1); a pasta temporária da sessão de host já é a pasta que o prompt apresenta e que a leitura de imagem conhece.
- Ligar a pasta de saída do host sem navegadores nem tela virtual: descartado no refino (D2); mudaria a ferramenta e o texto de uma etapa que hoje não os tem.

## Perguntas abertas

- Nenhuma bloqueante para o refino nem para o plano. **Não verificado:** o comportamento do modo host (nenhum comando, nenhum run, nenhuma tela em nenhuma etapa até aqui); o caminho de uma etapa de host que roda de novo sobre comprovação já guardada; a corrida da suíte nesta cópia.

## Onde o trabalho está

- A triagem entrega o `0_TRIAGE.md` e o refino entrega o `1_SPEC.md`, na pasta do ciclo. Nada foi mudado no código; nenhum documento da #142 pertence a este ciclo.
- O `1_SPEC.md` traz: o que muda para quem usa, 8 regras numeradas, as duas decisões fixadas (D1 e D2) com motivo e consequência aceita, o que fica fora, 8 critérios de aceite verificáveis e as pendências ditas como não verificadas.
- Passagem refino → plano: planejar a partir do `1_SPEC.md`, sem reabrir D1/D2, confirmando a #142 na base, olhando os pontos do executor, da sessão de host, da resolução de caminho, do fecho e dos dois catálogos, e prevendo os testes dos critérios 1–6 (fixtures de host com pasta de saída no fake de sandbox). A nota de lançamento entra no `CHANGELOG.md` sob `## [Unreleased]` na implementação ou no fecho do ciclo.
- Passagem support → product-owner: Refinar a #143 em `1_SPEC.md`: fixar as duas decisões em aberto (a pasta de saída do host como raiz da leitura da comprovação — reaproveitar a pasta de etapa ou ligar as ferramentas à pasta criada pelo host — e o que conta como "testar uma interface" numa etapa de host; hoje a pasta só nasce com navegadores ou tela virtual ligados, e ligá-la sem eles muda o prompt de uma etapa que hoje não a tem). O material desta etapa é leitura de código, não execução: o comportamento do modo host não foi exercitado. A entrega depende da #142 já mesclada (ambas mexem no mesmo arquivo do executor); se a #142 … <!-- handoff:6 -->

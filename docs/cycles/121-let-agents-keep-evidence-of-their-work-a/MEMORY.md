# Memória do ciclo

## Decisões

- Issue classificada como pedido de funcionalidade: um agente guarda o que capturou como comprovação da etapa e marca a imagem; a pessoa vê na execução e a comprovação pode ir ao host de código.
- Refino do produto concluído: a spec funcional está em `1_SPEC.md`, com 27 regras em quatro blocos (guardar, marcar, usar, levar ao host), o fora do escopo e 13 critérios de aceite. Prioridade proposta: `priority:high`. Marco proposto: `0.7.0` (próxima versão menor depois da 0.6.1); a lista de marcos do rastreador não foi alcançada, então fica a confirmar.
- **A base de anexos entra nesta issue.** A resposta da pessoa foi "você pode estar com a versão da main desatualizada, verifique isso, se não existir deve ser criado". Conferido: a linha principal (após `git fetch`) está no mesmo ponto da cópia e nada de anexos entrou nela. Pela resposta, o armazenamento de anexos e a mensagem que carrega arquivos entram junto com a comprovação (regra 8), e as duas peças de imagem que a issue citava como prontas (`ViewImage` e a leitura da imagem da pasta de saída), que não existem, entram também (regra 15).
- Decisões fixadas na spec: formatos aceitos (PNG, JPEG, GIF, WebP; `text/plain`; PDF) e recusados (vídeo, áudio, compactado, executável), tipo conferido pelo conteúdo e não pelo nome; id no formato `ev-<algarismos>`; a comprovação é anexo da mensagem da conversa; as quatro travas contra dado privado (padrão só nos dados do app, borrão, revisão antes do "sim", origem restrita à pasta de saída); o que cada host suporta ao embutir imagem (GitHub, GitLab, Bitbucket), com o texto "quantas comprovações existem e que estão no app" onde não der.
- Pergunta registrada para a pessoa (pergunta 1 da spec): a publicação da imagem segue a autonomia do agente (o autônomo publica sozinho) ou espera sempre o "sim", como o push e o pull request? A decisão fica nas mãos de quem mantém; a issue fala pela autonomia.
- Resposta: voce pode estar com a versã oda main desatualizada, verifique isso, se não existir deve ser criado <!-- answer:14 -->

## Restrições

- O que existe hoje (conferido por leitura): a pasta de saída da sandbox é `/coxia/out` e é apagada com a etapa; o cenário de QA já cita comprovação por número de comando (`executed`/`read`); `Settings › Runner` existe sem nenhuma escolha de onde guardar comprovação; workspace de teste recusa escrita externa; escrita externa de agente autônomo sai auditada e a dos outros espera um "sim"; nenhuma biblioteca de imagem nas dependências e nenhum desenho de imagem no processo principal.
- O que **não existe** na linha principal: `ViewImage`, `readOutputImage`, armazenamento de anexos, decisão de onde guardar a comprovação e qualquer imagem em cenário de QA.
- No histórico do repositório há documentos de outra issue (registro, triagem, refino e plano), em outra ramificação, que descrevem onde o anexo ficaria (`workspaces/<id>/…`), o tipo pelo conteúdo e a mensagem carregando arquivos. Esse trabalho **não está na linha principal**; não verificado se essa ramificação será mesclada — se for, parte da base pode chegar de fora.
- A issue é só spec funcional: projeto e plano ficam para o refinamento e o planejamento.
- Fora do escopo por decisão da issue: vídeo e gravação de tela; edição da comprovação à mão no app. Fora do escopo por leitura da spec: a comprovação não é artefato de etapa (não entra em `produces`/`reads`); anotar documento que não seja imagem; escolher o provedor de envio; automatizar a borra.
- Material público: a comprovação não pode levar segredo, token ou dado privado a um commit ou comentário; as travas são o padrão só nos dados do app, o borrão, a revisão antes do "sim" e a origem restrita à pasta de saída.

## Tentado e descartado

- Rodar os gates do repositório: descartado, é trabalho de implementação e a etapa só lê.
- Esperar de fora a base de anexos como issue separada: descartado depois da resposta da pessoa, que manda criar o que não existir; a base entra nesta entrega.
- Buscar issues semelhantes fora da pasta do ciclo e do código: não feito; nenhuma outra issue do checkout tem o mesmo pedido.

## Perguntas abertas

- Nenhuma de quem abriu a issue. A do portão está na spec: se a publicação da imagem de um agente autônomo sai sozinha (como as outras escritas dele) ou espera sempre o "sim", como o push e o pull request.

## Onde o trabalho está

Triagem em `0_TRIAGE.md` e refino em `1_SPEC.md`, na pasta do ciclo. Próxima etapa: portão 1 e, depois, o plano técnico. Nada de código foi tocado nesta etapa.
- Passagem support → product-owner: Refinamento do produto: transformar o pedido em spec funcional (as quatro partes estão na issue, falta a ordem e em que etapa do ciclo cada uma entra) e fixar no texto o que o critério de aceite não nomeia: captura de tela e imagem da pasta de saída como formatos aceitos e o que é recusado; o que é comprovação sensível (segredo, token, dado privado) e como a marca de borrão e o padrão "só nos dados do app" mantêm isso fora de um commit e de um comentário; o formato do id de comprovação citado por um cenário de QA e pela saída de etapa (hoje o cenário só cita números de comando); e o que cada h… <!-- handoff:6 -->

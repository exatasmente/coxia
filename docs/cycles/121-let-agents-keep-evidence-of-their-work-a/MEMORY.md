# Memória do ciclo

## Decisões

- Issue classificada como pedido de funcionalidade: agente guarda o que capturou (comprovação da etapa) e marca a imagem; a pessoa vê na execução e isso pode ir ao host de código.
- Nada falta a quem abriu: a issue define comportamento, limites e critério de aceite; nenhuma pergunta publicada.
- Sugestão de prioridade (não é proposta): `priority:medium`, capacidade nova, sem erro em uso, com pré-requisito declarado; a prioridade final é do refinamento do produto.

## Restrições

- A issue depende da #120 (armazenamento de anexos e como uma mensagem carrega arquivos), e a #120 **não existe neste checkpoint** — não há pasta de ciclo dela nem menção no changelog. Não verificado se está pendente ou em outra branch; se não estiver pronta, a parte de anexos desta issue não se sustenta, mesmo que as ferramentas de guardar e marcar sirvam à pasta de saída por si.
- O que existe hoje: a pasta de saída da sandbox é `/coxia/out` e é apagada com a etapa; o cenário de QA já cita comprovação por número de comando (`executed`/`read`); `Settings › Runner` existe sem nenhuma escolha de onde guardar comprovação; workspace de teste recusa escrita externa; escrita externa de agente autônomo sai auditada e a dos outros espera um "sim".
- O que a issue cita e **não existe** no código: a ferramenta `ViewImage`, a função `readOutputImage`, armazenamento de anexos, e qualquer desenho de imagem no processo principal (nenhuma biblioteca de imagem nas dependências).
- A issue é só spec funcional: projeto e plano ficam para o refinamento e o planejamento.
- Fora do escopo por decisão da issue: vídeo e gravação de tela; edição da comprovação à mão no app.
- Material público: as comprovações não podem levar segredo nem dado privado para um commit ou comentário; a marca de borrão, a revisão antes do "sim" e o padrão "só dados do app" são as travas que a spec precisa explicar.

## Tentado e descartado

- Rodar os gates do repositório: descartado, é trabalho de implementação e a etapa só lê; nada foi executado.
- Buscar issues semelhantes fora da pasta do ciclo e do código: não feito; nenhuma outra issue do checkout tem o mesmo pedido.

## Perguntas abertas

Nenhuma.

## Onde o trabalho está

Triagem escrita em `docs/cycles/[redacted]/0_TRIAGE.md`. Próxima etapa: refinamento do produto (ver handoff).

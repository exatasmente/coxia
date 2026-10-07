# Memória do ciclo

## Decisões

- Issue classificada como pedido de funcionalidade: um agente guarda o que capturou como comprovação da etapa e marca a imagem; a pessoa vê na execução e a comprovação pode ir ao host de código. Portão 1 aprovado.
- Refino em `1_SPEC.md` (27 regras, o fora do escopo, 13 critérios) e plano em `2_PLAN.md`. A base de anexos entra nesta entrega (regra 8), junto com `ViewImage` e a leitura da imagem da pasta de saída (regra 15).
- Desenho fixado no plano e seguido na implementação: comprovação em `<workspace data>/evidence/<runId>/<id>.<ext>`, id `ev-<algarismos>` estável na execução, some com a execução; `runner.evidence: 'app' | 'cycle'` (padrão `'app'`) vira config 13 com o passo `v12ToV13`; a raiz de leitura é `<stageDir>/out` no host (o `/coxia/out` é o caminho de dentro), resolvida com o `checkPath` e sem seguir link; tipo pelo conteúdo; `AnnotateImage` desenha no processo principal a partir de dados, sem biblioteca de imagem; a cópia da pasta do ciclo é feita pelo app no fim da etapa.
- Escolha `runner.evidence` recusada ao navegador pareado (`WEB_EDITABLE`), como `runner.identity`: decide o que entra num commit.
- Resposta: voce pode estar com a versã oda main desatualizada, verifique isso, se não existir deve ser criado <!-- answer:14 -->

## Restrições

- Material público: a comprovação não pode levar segredo, token ou dado privado a um commit ou a um comentário; as quatro travas da spec (padrão só nos dados do app, borrão, revisão antes do "sim", origem restrita à pasta de saída com tipo pelo conteúdo).
- Texto de catálogo nunca fixa a palavra de um host: o pedido de mudança sai por `{crLong}` (o teste de vazamento de termos falha se aparecer "pull request"/"merge request" ao pé da letra).
- As chaves de cada catálogo de tela ficam em ordem alfabética (o teste `ui-i18n` falha fora de ordem).
- Config: mudança de esquema precisa do passo em `STEPS` e dos três de `types.ts`, `defaults.ts` e `schema.ts`.
- Toda escrita externa passa pela porta de Ações; a comprovação não é artefato de etapa (não entra em `produces`/`reads`); fora do escopo: vídeo, editar a comprovação à mão, enviar sem citação, automatizar a borra.

## Tentado e descartado

- Testar as ferramentas de comprovação com o agente no `shell` padrão: não dá, o agente precisa de `shell: sandbox` para receber as ferramentas; o teste de ponta a ponta põe `qa.shell = 'sandbox'`.
- Escrever "pull request" no texto do catálogo: descartado, o teste de termos de host recusa; virou `{crLong}`.
- Biblioteca de imagem nas dependências: descartado (binário nativo/tamanho); o PNG é um codec próprio mínimo.

## Perguntas abertas

- A pergunta do portão segue sem resposta: se a publicação da imagem de um agente autônomo sai sozinha ou espera sempre o "sim". Como o envio ao host não foi implementado (abaixo), ela segue em aberto para a continuação.
- Nenhuma pergunta de quem abriu a issue.

## Onde o trabalho está

- **Implementação (tentativa 2):** o worktree traz os passos 1 a 8 do plano — as três ferramentas (`SaveEvidence`, `AnnotateImage`, `ViewImage`), a base de anexos, o armazenamento da comprovação, o desenho e o codec PNG próprios, a escolha de config v13, o executor, o prompt, os canais e as telas. O typecheck passa; os testes desta mudança passam.
- **Falta, conferido por leitura:** o passo 9 (levar ao host: upload no `VcsWriteOp`/`planWrite` e o embutir no comentário) e o passo 10 (docs e changelog). Isto é o bloco 4 da issue e as regras 22-27 da spec (aceite 3 e 11). Também falta: `AnnotateImage` só decodifica PNG — JPEG, GIF e WebP são aceitos e vistos, mas não marcados.
- A última execução completa da suíte não foi lida até o fim (o tempo da etapa acabou); os arquivos desta mudança e os que ela toca foram rodados e passaram. Próxima etapa: continuar a implementação (passos 9 e 10) e, depois, a revisão.
- `3_IMPLEMENTATION.md` na pasta do ciclo descreve o que mudou, o que foi conferido e o que falta.
- Passagem support → product-owner: Refinamento do produto: transformar o pedido em spec funcional (as quatro partes estão na issue, falta a ordem e em que etapa do ciclo cada uma entra) e fixar no texto o que o critério de aceite não nomeia: captura de tela e imagem da pasta de saída como formatos aceitos e o que é recusado; o que é comprovação sensível (segredo, token, dado privado) e como a marca de borrão e o padrão "só nos dados do app" mantêm isso fora de um commit e de um comentário; o formato do id de comprovação citado por um cenário de QA e pela saída de etapa (hoje o cenário só cita números de comando); e o que cada h… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Levar a spec de `1_SPEC.md` ao portão 1 e, depois, ao plano técnico. A spec fixa o que o plano precisa cobrir, e agora inclui a base de anexos desta entrega (regra 8) e as duas peças de imagem que a issue citava como prontas (regra 15), porque a linha principal do repositório não as tem. O plano decide: onde a comprovação fica em `workspaces/<id>/…` e como é apagada com a execução; como o armazenamento de anexos e a mensagem que carrega arquivos entram (é o pré-requisito interno, não de fora); como a pasta de comprovações da pasta do ciclo é copiada e commitada com a etapa quando o espaço de t… <!-- handoff:60 -->
- Passagem tl-plataforma → pessoa: Plano técnico em `2_PLAN.md`. Próxima etapa: portão 2 e, depois, a implementação. A ordem de trabalho está no plano; os pontos que a implementação precisa fechar: (1) reescrever a `MEMORY.md` na conclusão; (2) a raiz de leitura da pasta de saída é `<stageDir>/out` no host, com `/coxia/out` sendo o caminho de dentro da sandbox — não confundir os dois; (3) adicionar a operação de upload a `VcsWriteOp` e aos três `planWrite`, no mesmo grupo de comandos e antes da escrita do comentário, sem sair da porta de Ações; (4) o esquema de config vira 13 com o passo `v12ToV13` em `STEPS`, e os três de `typ… <!-- handoff:74 -->

# Memória do ciclo

## Decisões

- Issue classificada como pedido de funcionalidade: um agente guarda o que capturou como comprovação da etapa e marca a imagem; a pessoa vê na execução e a comprovação pode ir ao host de código. Portão 1 aprovado; spec em `1_SPEC.md` (27 regras, fora do escopo, 13 critérios) e plano em `2_PLAN.md` (dez passos).
- Desenho fixado no plano e seguido na implementação: comprovação em `<workspace data>/evidence/<runId>/<id>.<ext>`, id `ev-<algarismos>` estável na execução, some com a execução; `runner.evidence: 'app' | 'cycle'` (padrão `'app'`) é config 13 com o passo `v12ToV13`; a raiz de leitura é `<stageDir>/out` no host (o `/coxia/out` é o caminho de dentro), resolvida com o `checkPath`; tipo pelo conteúdo; `AnnotateImage` desenha no processo principal a partir de dados, com codec PNG próprio; a cópia da pasta do ciclo é feita pelo app no fim da etapa.
- Escolha `runner.evidence` recusada ao navegador pareado (`WEB_EDITABLE`), como `runner.identity`: decide o que entra num commit.
- Resposta da pessoa: a cópia podia estar desatualizada, era para conferir e, se não existisse, criar. Conferido que a base de anexos não existia na linha principal; ela entrou nesta entrega (regra 8), junto com `ViewImage` e a leitura da imagem da pasta de saída (regra 15).
- Resposta: voce pode estar com a versã oda main desatualizada, verifique isso, se não existir deve ser criado <!-- answer:14 -->

## Restrições

- Material público: a comprovação não pode levar segredo, token ou dado privado a um commit ou a um comentário; as quatro travas da spec (padrão só nos dados do app, borrão, revisão antes do "sim", origem restrita à pasta de saída com tipo pelo conteúdo).
- Texto de catálogo nunca fixa a palavra de um host: o pedido de mudança sai por `{crLong}` (o teste de vazamento de termos falha ao pé da letra).
- As chaves de cada catálogo de tela ficam em ordem alfabética (o teste `ui-i18n` falha fora de ordem).
- Config: mudança de esquema precisa do passo em `STEPS` e dos três de `types.ts`, `defaults.ts` e `schema.ts`.
- Toda escrita externa passa pela porta de Ações; a comprovação não é artefato de etapa (não entra em `produces`/`reads`); fora do escopo: vídeo, editar a comprovação à mão, enviar sem citação, automatizar a borra.

## Tentado e descartado

- Testar as ferramentas de comprovação com o agente no `shell` padrão: não dá, o agente precisa de `shell: sandbox` para receber as ferramentas; o teste de ponta a ponta põe `qa.shell = 'sandbox'`.
- Escrever "pull request" no texto do catálogo: descartado, o teste de termos de host recusa; virou `{crLong}`.
- Biblioteca de imagem nas dependências: descartado (binário nativo/tamanho); o PNG é um codec próprio mínimo.

## Perguntas abertas

- A pergunta do portão segue sem resposta: se a publicação da imagem de um agente autônomo sai sozinha ou espera sempre o "sim". Como o envio ao host não foi implementado, ela segue em aberto para a continuação.
- Nenhuma pergunta de quem abriu a issue.

## Onde o trabalho está

- **Revisão (tentativa 1) concluída com veredito `changes`.** O worktree traz os passos 1 a 8 do plano: as três ferramentas, a base de anexos, o armazenamento da comprovação, o desenho e o codec PNG próprios, a config v13, o executor, o prompt, os canais e as telas.
- **Portas do repositório que esta etapa rodou, todas verdes:** `npx tsc --noEmit`; `npx vitest run` (3695 de 3696; a única falha é um teste de tempo de `update.sh`, alheio à mudança — isolado ele passa); `node scripts/theme-audit.mjs`; `npm run i18n:lint`; `node scripts/public-audit.mjs`.
- **Exercitado sem sandbox, sem modelo e sem host:** as recusas das ferramentas (caminho fora, `..`, link, teto, conteúdo não declarado, pasta de leitura do computador), o tipo pelo conteúdo, o id `ev-1`/`ev-2`, a cópia para `docs/cycles/<n>-<slug>/evidence/`, e que uma chave inexistente na pasta de saída é recusada.
- **Bloqueante 1:** falta o passo 9 — o bloco 4 da issue e as regras 22 a 27 da spec (critérios 3 e 11) não têm código: nenhuma operação de upload, nenhum embutir de imagem.
- **Bloqueante 2:** falta o passo 10 — nada em `docs/runner.md`, `docs/configuration.md` nem no `## [Unreleased]` do `CHANGELOG.md` (conferido por leitura).
- **Bloqueante 3:** no host os vínculos das dependências ficam dentro da pasta de saída (`<stageDir>/out`) e o sandbox monta essa pasta como ela é; a recusa de link só cobre o caminho escrito, então `node_modules/algo/x.txt` é aceito. A spec promete "nunca um caminho que passe por um link".
- **Menores anotados na revisão:** chave `ui.runner.evidenceApp` faltando no catálogo português de telas (o inglês a tem); `ui.runner.evidenceHint` duplicada nesse arquivo; dois textos de interface escritos fixos no JSX (`TITLE`, `TXT`); classe `cy-evidence-block` sem CSS (e as irmãs sem estilo); o id na citação de comprovação é mostrado sem acento (`#{id}`), contra o `ev-3` que a spec fixa; k. Notes: `AnnotateImage` só decodifica PNG — JPEG, GIF e WebP são aceitos, vistos e baixados, mas não marcados (limitação já registrada na implementação).
- **Próxima etapa:** continuar a implementação (passos 9 e 10, com o conserto da raiz de leitura e os menores) e revisar de novo.
- Passagem developer → revisor-plataforma: continuar a implementação (passo 9, passo 10 e a decodificação de JPEG/GIF/WebP), depois rodar a suíte e as portas do repositório. <!-- handoff:263 -->
- Passagem support → product-owner: Refinamento do produto: transformar o pedido em spec funcional (as quatro partes estão na issue, falta a ordem e em que etapa do ciclo cada uma entra) e fixar no texto o que o critério de aceite não nomeia: captura de tela e imagem da pasta de saída como formatos aceitos e o que é recusado; o que é comprovação sensível (segredo, token, dado privado) e como a marca de borrão e o padrão "só nos dados do app" mantêm isso fora de um commit e de um comentário; o formato do id de comprovação citado por um cenário de QA e pela saída de etapa (hoje o cenário só cita números de comando); e o que cada h… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Levar a spec de `1_SPEC.md` ao portão 1 e, depois, ao plano técnico. A spec fixa o que o plano precisa cobrir, e agora inclui a base de anexos desta entrega (regra 8) e as duas peças de imagem que a issue citava como prontas (regra 15), porque a linha principal do repositório não as tem. O plano decide: onde a comprovação fica em `workspaces/<id>/…` e como é apagada com a execução; como o armazenamento de anexos e a mensagem que carrega arquivos entram (é o pré-requisito interno, não de fora); como a pasta de comprovações da pasta do ciclo é copiada e commitada com a etapa quando o espaço de t… <!-- handoff:60 -->
- Passagem tl-plataforma → pessoa: Plano técnico em `2_PLAN.md`. Próxima etapa: portão 2 e, depois, a implementação. A ordem de trabalho está no plano; os pontos que a implementação precisa fechar: (1) reescrever a `MEMORY.md` na conclusão; (2) a raiz de leitura da pasta de saída é `<stageDir>/out` no host, com `/coxia/out` sendo o caminho de dentro da sandbox — não confundir os dois; (3) adicionar a operação de upload a `VcsWriteOp` e aos três `planWrite`, no mesmo grupo de comandos e antes da escrita do comentário, sem sair da porta de Ações; (4) o esquema de config vira 13 com o passo `v12ToV13` em `STEPS`, e os três de `typ… <!-- handoff:74 -->

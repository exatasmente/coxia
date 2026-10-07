# Memória do ciclo

## Decisões

- Issue classificada como pedido de funcionalidade: um agente guarda o que capturou como comprovação da etapa e marca a imagem; a pessoa vê na execução e a comprovação pode ir ao host de código. Portão 1 aprovado; spec em `1_SPEC.md` (27 regras, 13 critérios) e plano em `2_PLAN.md` (dez passos).
- Desenho fixado no plano: comprovação em `<workspace data>/evidence/<runId>/<id>.<ext>`, id `ev-<algarismos>` estável na execução, some com a execução; `runner.evidence: 'app' | 'cycle'` (padrão `'app'`) é config 13 com o passo `v12ToV13`; a raiz de leitura é `<stageDir>/out` no host (o `/coxia/out` é o caminho de dentro); tipo pelo conteúdo; `AnnotateImage` desenha no processo principal a partir de dados, com codec PNG próprio; a cópia da pasta do ciclo é feita pelo app no fim da etapa.
- Escolha `runner.evidence` recusada ao navegador pareado (`WEB_EDITABLE`), como `runner.identity`: decide o que entra num commit.
- Conferido que a base de anexos não existia na linha principal; ela entrou nesta entrega (regra 8), junto com `ViewImage` e a leitura da imagem da pasta de saída (regra 15).
- **Envio ao host (passo 9), refeito nesta tentativa para fechar o bloqueante:** a imagem citada **não sai mais na hora de montar o comentário**; ela é **parte do mesmo grupo de comandos** que o "sim" libera. `VcsWriteOp.uploadAttachment` + `VcsCommand.bodyFile`/`headers` por provedor (GitHub na hospedagem de arquivos do host, GitLab em `projects/<path>/uploads`, Bitbucket em `repositories/<path>/downloads`); o cabeçalho com o token é preenchido **na hora de rodar** (`actions.withUploadHeaders`), nunca guardado na proposta. O publicador planeja os uploads como os primeiros comandos do grupo (`planEvidence`) e guarda as posições e o índice do comando do corpo na proposta (`ReleaseAction.evidence`); `actions.withEvidenceEmbeds` embute o endereço que o host respondeu no corpo **antes** de o comentário rodar. Agente autônomo: dois `door.post` auditados (uploads, depois o comentário com os endereços). Descrição do pull request: os ids citados ficam no rascunho (`CommentRecord.evidenceIds`) e os uploads entram no grupo da proposta do `createMr`. Onde o host não aceita o arquivo, o comentário diz quantas comprovações existem e que elas estão no app.
- Resposta da pessoa, ainda valendo: "se não existir deve ser criado" — o que faltava entrou nesta entrega (regra 8).
- Resposta: voce pode estar com a versã oda main desatualizada, verifique isso, se não existir deve ser criado <!-- answer:14 -->
- Resposta: Volta e pede pra resolver <!-- answer:417 -->

## Restrições

- Material público: a comprovação não pode levar segredo, token ou dado privado a um commit ou a um comentário; as quatro travas da spec (padrão só nos dados do app, borrão, revisão antes do "sim", origem restrita à pasta de saída com tipo pelo conteúdo). A trava "a pessoa vê cada imagem antes do sim" agora se sustenta: um comentário que espera não põe imagem no host até a confirmação.
- Texto de catálogo nunca fixa a palavra de um host: o pedido de mudança sai por `{crLong}` (o teste de vazamento de termos falha ao pé da letra).
- As chaves de cada catálogo de tela ficam em ordem alfabética (o teste `ui-i18n` falha fora de ordem).
- Config: mudança de esquema precisa do passo em `STEPS` e dos três de `types.ts`, `defaults.ts` e `schema.ts`.
- Toda escrita externa passa pela porta de Ações; a comprovação não é artefato de etapa (não entra em `produces`/`reads`); fora do escopo: vídeo, editar a comprovação à mão, enviar sem citação, automatizar a borra.
- A porta de leitura da pasta de saída confere o caminho **real**: um arquivo atrás de um vínculo de dependência dentro da pasta é recusado (a spec promete "nunca um caminho que passe por um link").
- O esquema da execução recusa propriedade fora da lista: um campo novo no registro de comentário (como `evidenceIds`) precisa entrar no `schema.ts`.
- Nenhum host real é usado no projeto: o envio é exercitado contra provedores falsos.

## Tentado e descartado

- Testar as ferramentas de comprovação com o agente no `shell` padrão: não dá, o agente precisa de `shell: sandbox` para receber as ferramentas; o teste de ponta a ponta põe `qa.shell = 'sandbox'`.
- Escrever "pull request" no texto do catálogo: descartado, o teste de termos de host recusa; virou `{crLong}`.
- Biblioteca de imagem nas dependências: descartado (binário nativo/tamanho); o PNG é um codec próprio mínimo.
- Passar o token do upload dentro do comando guardado na proposta: descartado, a proposta nunca guarda credencial; o cabeçalho é preenchido na hora de rodar.
- Resolver o endereço da imagem embutindo um **marcador** no corpo guardado na proposta: descartado, a proposta guardaria texto que não é o final; a posição de cada upload no grupo resolve sem placeholder.
- Marcar imagem não-PNG (JPEG, GIF, WebP): continua de fora, `AnnotateImage` só decodifica PNG.

## Perguntas abertas

- A pergunta do portão segue sem resposta: se a publicação da imagem de um agente autônomo sai sozinha ou espera sempre o "sim". O envio segue a autonomia do agente, como o comentário; a decisão é de quem mantém e não trava o trabalho.
- Nenhuma pergunta de quem abriu a issue.

## Onde o trabalho está

- **Os dez passos do plano estão no worktree** (entrega anterior no commit `f347c6f`): as três ferramentas, a base de anexos, o armazenamento, o desenho e o codec PNG, a config v13, o executor, o prompt, os canais e as telas, o envio ao host e a documentação/changelog.
- **Esta tentativa fechou o bloqueante da revisão 2 e o menor:** a imagem citada sobe com a escrita que a cita, não antes do "sim" (comentário de etapa e descrição do pull request), e o comentário duplicado de `src/main/evidence/paths.ts` saiu. Arquivos tocados: `src/main/runner/publish.ts`, `src/main/actions.ts`, `src/main/runner/door.ts`, `src/shared/types.ts`, `src/shared/runs/types.ts`, `src/shared/runs/transitions.ts`, `src/shared/runs/schema.ts`, `docs/runner.md`, `CHANGELOG.md` e os testes.
- **Portas do repositório, todas verdes nesta tentativa:** `npx tsc --noEmit`; `npx vitest run` (3704 de 3704, 228 arquivos); `node scripts/theme-audit.mjs`; `npm run i18n:lint` (4106 chaves); `node scripts/public-audit.mjs` (927 arquivos).
- **Exercitado por teste:** um comentário de agente que **espera** não posta nada — a proposta é criada com o upload como primeiro comando e o comentário como último (o caso novo de `test/runner-evidence-upload.test.ts`); um grupo sob "sim" roda o upload antes do comentário e o endereço que o host responde sai embutido no texto (o caso novo de `test/actions-group.test.ts`); o agente autônomo sobe a imagem e o comentário sai com o endereço (os dois casos antigos seguem verdes). `test/runs-policy.test.ts` deixou de exigir que o publicador chame `uploadToken`.
- **Limitação conhecida:** `AnnotateImage` só decodifica PNG — JPEG, GIF e WebP são aceitos, vistos, baixados e enviados, mas não marcados.
- **Não verificado:** nenhum host real (o envio é contra provedores falsos); a conversa, o navegador pareado e o telefone foram lidos no código, não abertos; a recusa do vínculo foi exercitada sobre o sistema de arquivos real, não dentro de uma sandbox de verdade; a descrição do pull request com comprovação citada não foi exercitada de ponta a ponta por teste (o mecanismo de embutir no "sim" foi exercitado no comentário).
- Passagem developer → revisor-plataforma: revisar a entrega inteira da 121 (os dez passos do plano e o envio da imagem agora dentro do grupo que o "sim" libera), com atenção à ordem upload → comentário e ao caso do agente que espera; rodar as cinco portas do repositório. A limitação conhecida segue: `AnnotateImage` só decodifica PNG. <!-- handoff:new -->
- Passagem support → product-owner: Refinamento do produto: transformar o pedido em spec funcional e fixar no texto o que o critério de aceite não nomeia. <!-- handoff:6 -->
- Passagem product-owner → pessoa: Levar a spec de `1_SPEC.md` ao portão 1 e, depois, ao plano técnico. <!-- handoff:60 -->
- Passagem tl-plataforma → pessoa: Plano técnico em `2_PLAN.md`. Próxima etapa: portão 2 e, depois, a implementação. <!-- handoff:74 -->
- Passagem pessoa → developer: Volta e pede pra resolver <!-- handoff:418 -->
- Passagem developer → revisor-plataforma: Continuar a implementação no worktree: (1) o passo 9 do plano — a operação de upload de imagem no `VcsWriteOp` (`src/main/vcs/types.ts`) e nos `planWrite` de GitHub/GitLab/Bitbucket, o embutir da imagem citada no corpo do comentário e na descrição do `crLong` em `src/main/runner/publish.ts`, no mesmo grupo de comandos e antes da escrita do comentário, pela porta de Ações; onde o host não embutir, o texto diz quantas comprovações existem e que estão no app; testes em `test/vcs-writes.test.ts`/`test/vcs-github.test.ts` contra o host falso, incluindo a recusa num espaço de trabalho de teste e o r… <!-- handoff:263 -->
- Passagem revisor-plataforma → developer: Revisão da entrega de 121 sobre os passos 1 a 8 do plano (compromisso b7ba8e1), contra a spec, o plano e a fronteira de segurança. A parte construída cumpre bem o núcleo: as três ferramentas existem e recusam o que a spec recusa (conferido exercitando os manipuladores: caminho fora, `..`, link dentro da pasta de saída, arquivo acima do teto e conteúdo que não confirma o declarado, cada um com o motivo); o tipo é lido dos bytes; a base de anexos leva o arquivo à mensagem da conversa; a config v13 tem o passo de migração e os três arquivos; as portas do repositório que rodei passaram (typecheck,… <!-- handoff:362 -->
- Passagem developer → revisor-plataforma: Revisar a entrega inteira da 121 (os dez passos do plano) contra a spec e o plano, com atenção ao envio ao host por provedor (que nenhum host real foi usado) e à raiz de leitura da pasta de saída. Rodar `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` e `node scripts/public-audit.mjs`. A limitação conhecida segue: `AnnotateImage` só decodifica PNG. <!-- handoff:399 -->

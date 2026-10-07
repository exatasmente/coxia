# Memória do ciclo

## Decisões

- Issue classificada como pedido de funcionalidade: um agente guarda o que capturou como comprovação da etapa e marca a imagem; a pessoa vê na execução e a comprovação pode ir ao host de código. Portão 1 aprovado; spec em `1_SPEC.md` (27 regras, 13 critérios) e plano em `2_PLAN.md` (dez passos).
- Desenho fixado no plano: comprovação em `<workspace data>/evidence/<runId>/<id>.<ext>`, id `ev-<algarismos>` estável na execução, some com a execução; `runner.evidence: 'app' | 'cycle'` (padrão `'app'`) é config 13 com o passo `v12ToV13`; a raiz de leitura é `<stageDir>/out` no host (o `/coxia/out` é o caminho de dentro); tipo pelo conteúdo; `AnnotateImage` desenha no processo principal a partir de dados, com codec PNG próprio; a cópia da pasta do ciclo é feita pelo app no fim da etapa.
- Escolha `runner.evidence` recusada ao navegador pareado (`WEB_EDITABLE`), como `runner.identity`: decide o que entra num commit.
- Conferido que a base de anexos não existia na linha principal; ela entrou nesta entrega (regra 8), junto com `ViewImage` e a leitura da imagem da pasta de saída (regra 15).
- **Envio ao host (passo 9), decidido nesta etapa:** `VcsWriteOp.uploadAttachment` + `VcsCommand.bodyFile`/`headers`, com uma operação por provedor (GitHub na hospedagem de arquivos do host, GitLab em `projects/<path>/uploads`, Bitbucket em `repositories/<path>/downloads`); o cabeçalho com o token é preenchido **na hora de rodar** (`actions.withUploadHeaders`), nunca guardado na proposta; o publicador embute o endereço que o host responde sob o texto e, onde o host não aceita o arquivo, o comentário diz quantas comprovações existem e que elas estão no app.
- Resposta: voce pode estar com a versã oda main desatualizada, verifique isso, se não existir deve ser criado <!-- answer:14 -->

## Restrições

- Material público: a comprovação não pode levar segredo, token ou dado privado a um commit ou a um comentário; as quatro travas da spec (padrão só nos dados do app, borrão, revisão antes do "sim", origem restrita à pasta de saída com tipo pelo conteúdo).
- Texto de catálogo nunca fixa a palavra de um host: o pedido de mudança sai por `{crLong}` (o teste de vazamento de termos falha ao pé da letra).
- As chaves de cada catálogo de tela ficam em ordem alfabética (o teste `ui-i18n` falha fora de ordem).
- Config: mudança de esquema precisa do passo em `STEPS` e dos três de `types.ts`, `defaults.ts` e `schema.ts`.
- Toda escrita externa passa pela porta de Ações; a comprovação não é artefato de etapa (não entra em `produces`/`reads`); fora do escopo: vídeo, editar a comprovação à mão, enviar sem citação, automatizar a borra.
- A porta de leitura da pasta de saída confere o caminho **real**: um arquivo atrás de um vínculo de dependência dentro da pasta é recusado (a spec promete "nunca um caminho que passe por um link").
- Nenhum host real é usado no projeto: o envio é exercitado contra provedores falsos.

## Tentado e descartado

- Testar as ferramentas de comprovação com o agente no `shell` padrão: não dá, o agente precisa de `shell: sandbox` para receber as ferramentas; o teste de ponta a ponta põe `qa.shell = 'sandbox'`.
- Escrever "pull request" no texto do catálogo: descartado, o teste de termos de host recusa; virou `{crLong}`.
- Biblioteca de imagem nas dependências: descartado (binário nativo/tamanho); o PNG é um codec próprio mínimo.
- Passar o token do upload dentro do comando guardado na proposta: descartado, a proposta nunca guarda credencial; o cabeçalho é preenchido na hora de rodar.

## Perguntas abertas

- A pergunta do portão segue sem resposta: se a publicação da imagem de um agente autônomo sai sozinha ou espera sempre o "sim". O envio segue a autonomia do agente, como o comentário; a decisão é de quem mantém e não trava o trabalho.
- Nenhuma pergunta de quem abriu a issue.

## Onde o trabalho está

- **Os dez passos do plano estão no worktree:** as três ferramentas, a base de anexos, o armazenamento, o desenho e o codec PNG, a config v13, o executor, o prompt, os canais e as telas, o envio ao host e a documentação/changelog. Os menores que a revisão apontou também entraram (a chave duplicada do catálogo, os textos de interface por `t()`, o CSS do bloco de comprovações, a linha de QA do prompt e a raiz de leitura).
- **Portas do repositório, todas verdes nesta etapa:** `npx tsc --noEmit`; `npx vitest run` (3702 de 3702); `node scripts/theme-audit.mjs`; `npm run i18n:lint`; `node scripts/public-audit.mjs`.
- **Exercitado sem sandbox, sem modelo e sem host:** as recusas das ferramentas; o tipo pelo conteúdo; o id `ev-1`/`ev-2`; a cópia para `docs/cycles/<n>-<slug>/evidence/`; o upload de uma comprovação citada com o endereço embutido sob o texto; o host que não aceita o arquivo dizendo quantas comprovações ficaram no app; o arquivo atrás de um vínculo de pasta dentro da pasta de saída recusado.
- **Limitação conhecida:** `AnnotateImage` só decodifica PNG — JPEG, GIF e WebP são aceitos, vistos, baixados e enviados, mas não marcados.
- **Não verificado:** nenhum host real (o envio é contra provedores falsos); a conversa, o navegador pareado e o telefone foram lidos no código, não abertos; a recusa do vínculo foi exercitada sobre o sistema de arquivos real, não dentro de uma sandbox de verdade.
- **Próxima etapa:** revisar a entrega inteira (passos 1 a 10) contra a spec e o plano, com atenção ao envio por provedor e ao caminho real da pasta de saída.
- Passagem developer → revisor-plataforma: revisar a entrega inteira (os dez passos, o envio ao host e os consertos da revisão); rodar a suíte e as portas do repositório. <!-- handoff:363 -->
- Passagem support → product-owner: Refinamento do produto: transformar o pedido em spec funcional (as quatro partes estão na issue, falta a ordem e em que etapa do ciclo cada uma entra) e fixar no texto o que o critério de aceite não nomeia: captura de tela e imagem da pasta de saída como formatos aceitos e o que é recusado; o que é comprovação sensível (segredo, token, dado privado) e como a marca de borrão e o padrão "só nos dados do app" mantêm isso fora de um commit e de um comentário; o formato do id de comprovação citado por um cenário de QA e pela saída de etapa; e o que cada host suporta. <!-- handoff:6 -->
- Passagem product-owner → pessoa: Levar a spec de `1_SPEC.md` ao portão 1 e, depois, ao plano técnico. A spec fixa o que o plano precisa cobrir, e agora inclui a base de anexos desta entrega (regra 8) e as duas peças de imagem que a issue citava como prontas (regra 15). <!-- handoff:60 -->
- Passagem tl-plataforma → pessoa: Plano técnico em `2_PLAN.md`. Próxima etapa: portão 2 e, depois, a implementação. <!-- handoff:74 -->
- Passagem revisor-plataforma → developer: Revisão da entrega de 121 sobre os passos 1 a 8 do plano (compromisso b7ba8e1); veredito `changes` por dois achados bloqueantes (o bloco 4 da issue e o passo 10) mais o vínculo de dependência na pasta de saída e menores. <!-- handoff:362 -->
- Passagem developer → revisor-plataforma: Continuar a implementação no worktree: (1) o passo 9 do plano — a operação de upload de imagem no `VcsWriteOp` (`src/main/vcs/types.ts`) e nos `planWrite` de GitHub/GitLab/Bitbucket, o embutir da imagem citada no corpo do comentário e na descrição do `crLong` em `src/main/runner/publish.ts`, no mesmo grupo de comandos e antes da escrita do comentário, pela porta de Ações; onde o host não embutir, o texto diz quantas comprovações existem e que estão no app; testes em `test/vcs-writes.test.ts`/`test/vcs-github.test.ts` contra o host falso, incluindo a recusa num espaço de trabalho de teste e o r… <!-- handoff:263 -->

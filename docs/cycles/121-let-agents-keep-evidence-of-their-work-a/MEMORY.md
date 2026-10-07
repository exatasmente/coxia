# Memória do ciclo

## Decisões

- Issue classificada como pedido de funcionalidade: um agente guarda o que capturou como comprovação da etapa e marca a imagem; a pessoa vê na execução e a comprovação pode ir ao host de código. Portão 1 aprovado; spec em `1_SPEC.md` (27 regras, 13 critérios) e plano em `2_PLAN.md` (dez passos).
- Desenho fixado no plano: comprovação em `<workspace data>/evidence/<runId>/<id>.<ext>`, id `ev-<algarismos>` estável na execução, some com a execução; `runner.evidence: 'app' | 'cycle'` (padrão `'app'`) é config 13 com o passo `v12ToV13`; a raiz de leitura é `<stageDir>/out` no host (o `/coxia/out` é o caminho de dentro); tipo pelo conteúdo; `AnnotateImage` desenha no processo principal a partir de dados, com codec PNG próprio; a cópia da pasta do ciclo é feita pelo app no fim da etapa.
- Escolha `runner.evidence` recusada ao navegador pareado (`WEB_EDITABLE`), como `runner.identity`: decide o que entra num commit.
- Conferido que a base de anexos não existia na linha principal; ela entrou nesta entrega (regra 8), junto com `ViewImage` e a leitura da imagem da pasta de saída (regra 15).
- **Envio ao host (passo 9):** `VcsWriteOp.uploadAttachment` + `VcsCommand.bodyFile`/`headers`, com uma operação por provedor (GitHub na hospedagem de arquivos do host, GitLab em `projects/<path>/uploads`, Bitbucket em `repositories/<path>/downloads`); o cabeçalho com o token é preenchido **na hora de rodar** (`actions.withUploadHeaders`), nunca guardado na proposta; o publicador embute o endereço que o host responde sob o texto e, onde o host não aceita o arquivo, o comentário diz quantas comprovações existem e que elas estão no app.
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

- **Os dez passos do plano estão no worktree** (commit `f347c6f`): as três ferramentas, a base de anexos, o armazenamento, o desenho e o codec PNG, a config v13, o executor, o prompt, os canais e as telas, o envio ao host e a documentação/changelog. Os menores das revisões anteriores entraram.
- **Portas do repositório, todas verdes na revisão 2:** `npx tsc --noEmit`; `npx vitest run` (3702 de 3702, 228 arquivos); `node scripts/theme-audit.mjs`; `npm run i18n:lint` (4106 chaves); `node scripts/public-audit.mjs` (927 arquivos).
- **Revisão 2 (esta etapa), veredito `changes`:** os três bloqueantes da revisão 1 foram atendidos (o envio ao host existe por provedor; documentação e changelog; a raiz de leitura recusa o arquivo comum atrás de um vínculo de dependência dentro da pasta) e o menor do vínculo está fechado. **Achado bloqueante novo:** o upload da comprovação citada sai pela via automática **antes** de qualquer "sim", mesmo quando o comentário que a cita espera em Ações (agente não autônomo) e mesmo na descrição do pedido de mudança, que sempre espera — a trava "a pessoa vê cada imagem antes de um sim" não se sustenta. Exercitado com um agente não autônomo: a proposta do comentário é criada e o comando com o arquivo já foi para o host. Menor: comentário duplicado em `src/main/evidence/paths.ts:60-61`.
- **Limitação conhecida:** `AnnotateImage` só decodifica PNG — JPEG, GIF e WebP são aceitos, vistos, baixados e enviados, mas não marcados.
- **Não verificado:** nenhum host real (o envio é contra provedores falsos); a conversa, o navegador pareado e o telefone foram lidos no código, não abertos; a recusa do vínculo foi exercitada sobre o sistema de arquivos real, não dentro de uma sandbox de verdade.
- **Próxima etapa:** voltar ao developer para fechar o bloqueante do envio (levar o upload para o grupo de comandos que o "sim" libera, inclusive na descrição do pedido de mudança) e o menor do comentário duplicado; depois, nova revisão.
- Passagem developer → revisor-plataforma: revisar a entrega inteira (os dez passos, o envio ao host e os consertos da revisão); rodar a suíte e as portas do repositório. <!-- handoff:363 -->
- Passagem support → product-owner: Refinamento do produto: transformar o pedido em spec funcional e fixar no texto o que o critério de aceite não nomeia. <!-- handoff:6 -->
- Passagem product-owner → pessoa: Levar a spec de `1_SPEC.md` ao portão 1 e, depois, ao plano técnico. <!-- handoff:60 -->
- Passagem tl-plataforma → pessoa: Plano técnico em `2_PLAN.md`. Próxima etapa: portão 2 e, depois, a implementação. <!-- handoff:74 -->
- Passagem revisor-plataforma → developer: Revisão da entrega de 121 sobre os passos 1 a 8 do plano (compromisso b7ba8e1); veredito `changes` por dois achados bloqueantes mais o vínculo de dependência na pasta de saída e menores. <!-- handoff:362 -->
- Passagem developer → revisor-plataforma: Continuar a implementação no worktree e revisar a entrega inteira da 121 contra a spec e o plano, com atenção ao envio ao host por provedor e à raiz de leitura. <!-- handoff:263 -->
- Passagem developer → revisor-plataforma: Revisar a entrega inteira da 121 (os dez passos do plano) contra a spec e o plano; rodar as cinco portas do repositório. A limitação conhecida segue: `AnnotateImage` só decodifica PNG. <!-- handoff:399 -->
- Passagem revisor-plataforma → developer: Fechar o bloqueante do envio da imagem ao host (o upload sai pela via automática antes do "sim" em `src/main/runner/publish.ts`) e o menor do comentário duplicado em `src/main/evidence/paths.ts`; depois, nova revisão. <!-- handoff:new -->

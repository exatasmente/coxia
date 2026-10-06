# Memória do ciclo

## Decisões

- Resposta: tratar a beta.2 já cortada como a beta desta release e apenas conferir/publicar o rascunho dela no host <!-- answer:49 -->
- Decisão: não esperar mais o retorno da beta ("pode liberar a versão estável"). <!-- decision:60 -->
- Decisão: a estável aprovada. <!-- decision:62 -->

## Restrições

- Toda beta, toda estável e todo push sempre esperam o "sim" da pessoa em Ações, mesmo com o
  agente rodando sozinho. Um passo só pode ser aprovado depois do corte dele; um push que
  encontra o remoto já com o que enviaria termina como "nada enviado", não como feito.
- Quem publica o rascunho da release é a pessoa; o agente nunca afirma publicado.
- Nada de "pronto" sem verificar: a beta publicada, a tag no remoto e o commit da branch foram
  conferidos nesta etapa contra o host, não presumidos.

## Tentado e descartado

- Cortar uma beta nova (0.6.0-beta.3) sobre a beta.2 ainda não confirmada como publicada:
  descartado pela pessoa, que tratou a beta.2 como a beta desta release.
- Pedir `merge-pr` para o #64: descartado — o host já o mostra MERGED em `98f7e24f` e o merge
  `766d101` é ancestral da branch. `open` não é necessário: a branch existe no remoto.

## Perguntas abertas

## Onde o trabalho está

- Todas as verificações que bloqueavam a estável estão fechadas, relidas contra o remoto atual:
  branch `release/0.6.0` no remoto em `79d7dd2`; tag anotada `v0.6.0-beta.2` apontando para
  `79d7dd2`; pré-release `v0.6.0-beta.2` **publicada** no host (`isDraft: false`,
  `isPrerelease: true`); os sete PRs (#50, #55, #61, #62, #63, #64, #65) MERGED e nenhum aberto
  contra a branch; CI verde em `79d7dd2`; `main` no remoto em `0792535`, já ancestral de
  `release/0.6.0` (merge é fast-forward).
- Passagem release-manager → pessoa, etapa "Cortar a estável": pedidos três passos, nesta
  ordem, todos esperando o "sim" em Ações e nenhum executado ainda — `stable` (integra
  release/0.6.0 na main e corta 0.6.0, tag `v0.6.0`), `push-branch` (main), `push-tag`
  (stable). Os pushes só podem ser aprovados depois do corte.
- Passagem release-manager → próxima etapa ("Stable no host"): quando os três passos tiverem
  rodado, confirmar, sem presumir, que o remoto tem a tag `v0.6.0` sobre a main
  (`refs/tags/v0.6.0^{}` em `refs/heads/main`) e que `main` no remoto está no commit do corte.
  Depois vem o rascunho: o workflow do tag constrói o rascunho `v0.6.0`, e conferir e publicar
  o rascunho é da pessoa. Se `main` tiver recebido push depois desta leitura, refazer a
  checagem. A versão estável é 0.6.0; a beta de onde ela vem é a `v0.6.0-beta.2`.
- Passagem release-manager → pessoa: Montar (release-assemble): pedir `merge-pr` apenas para o #64 se ele estiver aprovado no host e sem conflito, no head em que for lido (o plano foi escrito com o head `[redacted]`; se ele tiver recebido push desde então, não integrar e pedir um plano novo). Os outros seis (#50, #55, #61, #62, #63, #65) já estão integrados na branch; a branch release/0.6.0 já existe, então `open` não é necessário. Se o #64 não estiver aprovado, deixá-lo fora: ele é o único item em risco. Depois do passo de integração, cortar a beta (`beta`), depois `push-branch` (release) e `push-tag` (beta), sempre na ordem e s… <!-- handoff:8 -->
- Passagem release-manager → pessoa: Depois do sim nos três passos desta etapa, a próxima etapa ("Beta no host", "Verificar rascunho" e publicação) tem de confirmar, sem presumir: a tag v0.6.0-beta.2 (ou o número que o corte tiver escolhido) no remoto apontando para o commit novo da branch, a branch release/0.6.0 no remoto com o commit do corte, e a pré-release publicada (o rascunho é publicado pela pessoa). Um corte que ficou só local, ou um push recusado ("nada enviado" quando o remoto já tem o que seria enviado), não é uma beta no host. Verificar também se o commit de conteúdo do #64 na branch (98f7e24) permanece o mesmo; se a… <!-- handoff:30 -->
- Passagem release-manager → pessoa: A beta desta release é a v0.6.0-beta.2 já cortada (commit 79d7dd2), não um corte novo. A próxima etapa (beta no host / verificar rascunho / publicação) deve confirmar, sem presumir, que o host mostra a pré-release `v0.6.0-beta.2` — publicada, rascunhada ou ausente ainda é não verificado. Se estiver rascunhada, a publicação é da pessoa. Confirmar também que a tag v0.6.0-beta.2 no remoto aponta para 79d7dd2 e que o remoto/release/0.6.0 ainda está nesse commit; se a branch recebeu push depois desta leitura, refazer a checagem. Não pedir nenhum corte novo de beta nesta release. <!-- handoff:54 -->

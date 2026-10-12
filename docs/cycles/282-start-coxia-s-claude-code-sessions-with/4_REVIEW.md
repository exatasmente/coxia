# Revisão, rodada 2: o plano continua desatualizado e não há código

## Veredito

**Mudanças.** O bloqueante da rodada 1 não foi tratado. O resumo do app informa que a branch não tem alteração fora da pasta do ciclo, e o 2_PLAN.md recebido nesta rodada é o mesmo texto da anterior: o passo 3 ainda liga a ponte por uma opção em `sdkOptions` e o passo 4 ainda não usa o id de `createCodeSession`. Nenhum critério de aceite está atendido.

## Bloqueantes anteriores

1. **Plano desatualizado (passos 3 e 4): não atendido.** A sondagem mostrou que passar opção ao `query()` não abre a ponte; o caminho é a API `./bridge` (alpha) acionada pelo processo principal. O plano segue sem isso.
2. **Cinco decisões de segurança sem dono: não atendidas.** Origem do token, recusa visível no espelho (ou reescrita do critério 3), entrada do modo control passar ou não pelas aprovações, comportamento em `untrusted_device`, `session_stale_relogin` e `oauth_rejected`, e arquivamento das sessões. A memória do ciclo as lista como abertas.
3. **Todo o resto por fazer:** política pura, configuração com migração, `webPolicy`, interface com aviso, auditoria, testes, CHANGELOG.

Não há fato novo nesta rodada, então nenhum bloqueante novo é aberto.

## O que foi lido

Memória do ciclo, 1_SPEC.md, 2_PLAN.md, 3_IMPLEMENTATION.md, a revisão anterior, o resumo do que a branch alterou e as passagens. Portões (`tsc`, `vitest`, `theme-audit`, `i18n:lint`, `public-audit`) não rodados: não há código alterado. Resultados da sondagem (ev-6, ev-7, ev-8) tomados como relato, não verificados aqui.

## Não verificado

- Resultados da sondagem, exceto como relatados.
- Aparição no app do celular.
- Duração da credencial do worker e renovação.
- Exigência de token de dispositivo confiável em outras contas.
- Reuso da auditoria da #268 para evento que não é escrita no host de código.
- Portões do repositório.

## Próximo passo

A tl-plataforma refaz o 2_PLAN.md (módulo isolado do processo principal com fake, auditoria pelo id de `createCodeSession`, as cinco decisões fixadas) antes de qualquer implementação. A origem do token e a entrada remota no modo control são decisões de segurança que podem precisar da pessoa.

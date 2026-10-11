# Revisão da rodada 4: as imagens da documentação agora mostram o que prometem, sem nomes reais

## Veredito

**Aprovado.** Os bloqueantes da rodada anterior foram tratados e nada novo bloqueia.

## Os bloqueantes anteriores

- **Nomes reais nas imagens.** Abertas nesta rodada: `wizard.png`, `today.png`, `actions.png`, `phone.png` e `call.png`. O assistente mostra o passo Modelos sem fornecedor, produto nem endereço de API. A tela Hoje, a fila de ações e o celular dizem "provedor de código", e as referências são `#124` e `docs#124`. A cerimônia mostra o turno semeado, "Ao vivo · 0:00" e nenhum aviso de falha nem nome de fornecedor.
- **Telas que não eram as prometidas.** A fila de ações agora tem o cabeçalho "Ações de release" e "Aguardando você". O celular é o companheiro em 390 px, com a barra de baixo (Hoje, Conversa, Ações). A cerimônia está em andamento.
- **Texto de `docs/images/README.md`.** O parágrafo sobre uma lista de pendências que não existia foi removido do diff.
- **Perfil do navegador dentro de `docs/images`.** `scripts/captures/phone.mjs` usa uma pasta temporária do sistema e a apaga no `finally`.
- **Campo de tela por etapa.** Já tratado na rodada 2 e sem mudança nesta.

## Achados

Nenhum bloqueante. Ficam as sugestões já registradas, sem reabrir:

- A conferência de referências não reconhece caminho relativo (`images/x.png`), por isso as variantes `-en` não reprovam nada.
- `stageDisplayOf` é chamado mais de uma vez por etapa.
- A expressão do veredito de tela está duplicada em `src/main/sandbox/index.ts`.
- `wizard.mjs` remove nós do DOM por heurística e é frágil diante de mudanças na tela.

## O que foi verificado nesta rodada

Foi lido o diff e foram abertas cinco imagens em pt-BR. Os gates (tsc, theme-audit, i18n:lint, public-audit, docs-images-check e vitest) e o byte a byte entre três execuções foram relatados na etapa anterior e **não foram reexecutados** aqui.

## Não verificado

- Aceitação 4: uma etapa com `display: true` guardar cada imagem como comprovação.
- Aceitação 6: um release refazer as imagens e o pull request mostrar só o que mudou.
- Igualdade byte a byte em outro computador.
- As imagens em inglês, que não foram abertas.

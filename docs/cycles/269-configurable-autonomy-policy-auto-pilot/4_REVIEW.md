# Revisão: aprovações dos passos na tela

Veredito: **aprovado**. Nenhum achado bloqueante.

## O que foi conferido nesta etapa

Lido:
- Ordem da decisão no intermediário (`src/main/browser/intermediary.ts`, etapa 4): passo livre roda; passo sensível sempre pergunta, e nem o passe do site nem a política o alcançam; tipo liberado roda e grava `screen-autonomous`; senão pergunta.
- Precedência (`src/shared/config/screenPolicy.ts`): agente, depois squad, depois workspace, depois padrão retido, tipo a tipo. `sanitizePolicy` descarta chaves desconhecidas e as quatro categorias.
- `confirmPortFor` (`engineTool.ts`): `pay` e `send` e as palavras sensíveis (inclusive as do site) sempre perguntam; o resto, com `agent` liberado, responde sim e grava o nível de origem.
- `screenPolicyRaised` (`configScope.ts`): o navegador pareado não libera um tipo nem tira uma retenção do agente ou do squad; `runner.screenPolicy` não é caminho editável por ele.
- `heldOnly` (`cycles/apply.ts`): modelos só trazem retenções; as liberações viram aviso na importação.
- `saveConfig` chama `auditPolicyChanges`: não grava na primeira carga e não lança.
- Repositório público: nada de nome, host ou número real nos trechos lidos. CHANGELOG e `docs/configuration.md` foram atualizados.

Executado:
- `electron-vite build`: saída 0, saída para pasta temporária.

## Achados

Nenhum bloqueante.

Sugestões:
1. `src/main/browser/sensitive.ts`: um passo de envio por Enter é checado só pelo campo em foco. Se o botão do formulário se chama "Pagar" e o campo tem nome neutro, o tipo `submit` liberado deixa o passo rodar. É um limite da heurística de palavras. Vale documentar ou, depois, olhar o botão de envio do formulário.
2. `src/main/workspaceConfig.ts`: importa `./browser/audit` só para registrar a mudança. Isso acopla a config ao módulo do navegador e pode formar um ciclo de imports com `auditoria`. Na mescla com a #268, que muda `saveConfig(next, by)`, vale mover o registro para um módulo neutro.

## Não verificado

- Testes (`vitest`, `tsc`, lints): não rodados de novo nesta etapa; valem os números da implementação.
- A tela e a janela de aprovação vistas no app.
- Os 4 testes de navegador real, que falham por falta de `@playwright/mcp`.
- O `autocomplete` de campo de cartão, que o probe não lê.
- Partes do diff que vieram cortadas (renderer, catálogos, migração, testes) foram lidas só em parte.

## Condição de lançamento

Não ir à produção sem a #268. Na mescla, unificar `screen-autonomous` e `screen-policy` com `auto-step` e `policy-change`.

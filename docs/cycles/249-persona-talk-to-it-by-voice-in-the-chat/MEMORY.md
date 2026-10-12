# Memória do ciclo

## Decisões

- Resposta da pessoa: volta e pede correção.
- Base do PR: release/0.11.0. Resolução do conflito: manter o CHANGELOG.md da branch.
- Resposta: volta e pedo correção <!-- answer:161 -->
- Resposta: b eu autorizo <!-- answer:197 --> (a mesclagem da base pelo shell foi autorizada só desta vez; feita em 053433c8)

## Restrições

- Fora a mesclagem autorizada uma vez (answer:197), merge, rebase e commit só pela ferramenta de conflito do app, nunca pelo shell.
- Esquema de configuração 34, igual ao da release; sem passo de migração novo.

## Tentado e descartado

- Alinhar o CHANGELOG da branch com a release para facilitar a mesclagem: o conflito persistiu (os dois lados escrevem logo abaixo de [Unreleased]); resolvido no merge mantendo o arquivo da branch.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- O código das cinco entregas, os testes e a documentação estão prontos. A base origin/release/0.11.0 foi mesclada no commit 053433c8, com o CHANGELOG.md mantido como na branch; agora a branch está 15 à frente e 0 atrás da release.
- Depois da mesclagem (ev-9): tsc com saída 0; 20 arquivos e 191 testes de voz/i18n/política passam; i18n:lint, theme-audit e public-audit limpos. Na suíte inteira falham os 4 arquivos do navegador (falta @playwright/mcp) e modules-registered falhou uma vez, mas passou sozinho (2/2).
- Falta: electron-vite build depois da mesclagem e abrir o PR com base release/0.11.0.
- Não verificado: o app com voz, a latência (meta de 3 s), o celular, o modelo seguir o prompt de voz e se há PRs abertos na release.
- Sugestões da revisão ainda abertas, que não bloqueiam: teste para "fala desligada não sintetiza"; latência só no console; acoplamento da marca de primeira palavra com player.speaking; separar GateNote/gateMessage.
- Passagem support → product-owner: Refinamento: decidir as três perguntas abertas (sim falado, meta de latência, tela bloqueada/foco), propor prioridade e avaliar dividir a entrega (extração do áudio compartilhado, voz no chat, modo de voz, celular). <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejamento: desenhar as quatro fatias (áudio compartilhado, voz no chat, modo de voz, celular), a origem "voz" no turno da persona e a fala por frase sobre o texto ao vivo; confirmar no código o comportamento de hoje, que veio só da triagem. Tratar as regras 11, 12 e 13 como propostas a confirmar. <!-- handoff:20 -->
- Passagem tl-experiencia → pessoa: Implementação: seguir 2_PLAN.md na ordem das entregas 1 a 5, um commit por entrega, todos passando em tsc, vitest, theme-audit, i18n:lint e public-audit. Começar pela Entrega 1 (dividir audio.ts em voice/ com reexport, callback de silêncio com motivo e heard) e provar que as cerimônias não mudaram. Na Entrega 2, conferir antes de tudo que o campo origin sobrevive ao armazenamento do fórum. Toda lógica nova em funções puras, porque o vitest roda em ambiente node, sem jsdom. Verificar na hora: onde abrir as configurações de voz (seção/âncora), o canal de log do renderer para a linha de latência … <!-- handoff:33 -->
- Passagem dev-experiencia → revisor-experiencia: Revisão/teste: o código das cinco entregas e os 12 testes novos estão na worktree; tsc, i18n:lint, public-audit e theme-audit passam, e os testes de voz também. Na suíte inteira, as falhas que restam são só dos testes do navegador (falta o pacote local @playwright/mcp). Falta verificar com o app rodando e a voz instalada: microfone no chat, modo de voz (estados, legendas, silenciar, encerrar, Ctrl/Cmd+Shift+M), fala antes do fim do texto, barge-in, a linha de latência no console (meta de 3 s), aviso com a voz desligada, e o celular com e sem https. electron-vite build não foi rodado. <!-- handoff:69 -->
- Passagem qa-experiencia → integrator: Integração: gates verdes (tsc, auditorias, 154 testes de voz); suíte inteira só falha nos 4 arquivos do navegador (falta @playwright/mcp). Antes de abrir o PR, ressalvar que app com voz, latência, celular e electron-vite build não foram verificados. <!-- handoff:90 -->
- Passagem integrator → dev-experiencia: Integração: devolver. A branch está 11 commits atrás de origin/release/0.11.0 e a mesclagem de teste dá conflito em CHANGELOG.md. Os demais itens passam: esquema 34 igual ao da release, gates, build e nomes de módulo novos. Cenário que falhou: Base atualizada com a release aberta. 11 commits atrás de origin/release/0.11.0; merge-tree acusa conflito em CHANGELOG.md. <!-- handoff:110 -->
- Passagem dev-experiencia → revisor-experiencia: Integração: trazer origin/release/0.11.0 pela ferramenta de conflito do app (a branch está 11 commits atrás). O conflito é só em CHANGELOG.md, e o lado da release nele ficou vazio: a resolução é manter o arquivo da branch como está. Fora de [Unreleased], ele já é idêntico ao da release, com o bloco beta.5 e os links (ev-4). Depois da mesclagem, rodar de novo tsc e os testes de voz, conferir o esquema 34 e então abrir o PR com base release/0.11.0. Na descrição, ressalvar que o app com voz, a latência e o celular não foram verificados. <!-- handoff:127 -->
- Passagem revisor-experiencia → qa-experiencia: Integração: trazer origin/release/0.11.0 pela ferramenta de conflito do app (conflito só em CHANGELOG.md; manter o arquivo da branch), rodar de novo tsc e os testes de voz, conferir esquema 34 e abrir o PR com base release/0.11.0, ressalvando que app com voz, latência e celular não foram verificados. <!-- handoff:133 -->
- Passagem qa-experiencia → integrator: Integração: trazer origin/release/0.11.0 pela ferramenta de conflito do app (só CHANGELOG.md conflita; manter o arquivo da branch), repetir tsc e testes de voz, e abrir o PR com base release/0.11.0 ressalvando app com voz, latência e celular não verificados. <!-- handoff:145 -->
- Passagem pessoa → qa-experiencia: volta e pedo correção <!-- handoff:162 -->
- Passagem qa-experiencia → integrator: Integração: trazer origin/release/0.11.0 pela ferramenta de conflito do app (só CHANGELOG.md conflita; manter o arquivo da branch), repetir tsc e testes de voz, abrir o PR com base release/0.11.0 ressalvando app com voz, latência e celular não verificados. <!-- handoff:174 -->
- Passagem integrator → dev-experiencia: Integração devolvida de novo só pela base: a branch está 13 à frente e 11 atrás de origin/release/0.11.0, e o merge-tree acusa conflito só em CHANGELOG.md. Esquema 34 igual ao da release, linha no CHANGELOG presente, nenhum nome de módulo novo colide. tsc e npm test foram observados nesta etapa: tsc exit 0; npm test só falha nos 4 arquivos do navegador (falta @playwright/mcp). Não rodei theme-audit, i18n:lint, public-audit nem electron-vite build. Cenário que falhou: Base atualizada com a release aberta. 13 à frente e 11 atrás de origin/release/0.11.0; merge-tree acusa conflito só em CHANGELOG… <!-- handoff:187 -->

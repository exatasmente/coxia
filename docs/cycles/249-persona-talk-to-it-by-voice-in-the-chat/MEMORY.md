# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, sem duplicada, squad experiencia. Refinamento: priority:medium, sem marco; propostas 11 ("sim" falado só sem efeito externo), 12 (meta 3 s, medir, débito não bloqueia), 13 (computador segue ouvindo; celular pausa ao bloquear/trocar de aba) valem como escritas. Aviso de privacidade do Edge nas configurações de voz (regra 14).
- Plano (2_PLAN.md): 5 entregas; todas implementadas, um commit só para a etapa.
- Sem canal IPC novo. Só o aparelho que enviou o turno fala a resposta. Voz da persona = voiceOfAgent(persona.id). Cerimônias não migradas.
- Configurações de voz abrem a tela settings (sem âncora); latência vai para console.info no renderer.
- Revisão: rodadas 1 e 2 aprovadas, sem bloqueantes; 4 sugestões abertas (teste do sayStream com fala desligada, latência só no console, acoplamento da marca de 1ª palavra, módulo próprio para stateText/gateMessage/GateNote).
- Integração devolveu duas vezes só pela base. O CHANGELOG da branch já foi alinhado à release; a nossa linha fica em [Unreleased] > Added.

## Restrições

- Texto novo nos dois catálogos, `.novoice` onde disser "call"; cores só por tokens; testes com fakes.
- vitest em ambiente node, sem jsdom: lógica em funções puras.
- Voz desligada/não instalada: sem microfone nem download. Celular: gravação exige https; instalar/ligar voz só no computador.
- Nunca merge/rebase/commit pelo shell; a base vem pela ferramenta de conflito do app. PR com base release/0.11.0, não main.

## Tentado e descartado

- params.origin em vez de campo próprio. Migrar telas que duplicam useTalk. Canal IPC novo para voz da persona.
- QA não abriu o app: sem voz instalada no ambiente.
- Evitar o conflito do CHANGELOG só pelo texto: impossível; resolução trivial (manter o da branch).

## Perguntas abertas

- Pessoa confirmar propostas 11–13 (não bloqueia).
- Não verificado: app rodando com voz, latência real, lacunas entre frases, barge-in com eco, celular real, atalho Ctrl/Cmd+Shift+M, modelo seguir o prompt de voz, aparência do modo de voz, PRs abertos na release, gates depois da mesclagem da base.
- 4 arquivos de teste do navegador falham por falta de @playwright/mcp (ambiente; visto de novo na integração tentativa 2).

## Onde o trabalho está

- Integração tentativa 2 (ev-6): ainda 11 à frente e 11 atrás de origin/release/0.11.0; conflito só em CHANGELOG.md; esquema 34 igual à release; CHANGELOG com a linha; tsc exit 0; vitest só falha os 4 arquivos do navegador.
- Próximo: trazer a base pela ferramenta de conflito do app (manter CHANGELOG da branch), repetir tsc e testes de voz, voltar à integração e abrir o PR com base release/0.11.0, ressalvando app com voz, latência e celular não verificados.
- Passagem support → product-owner: Refinamento: decidir as três perguntas abertas (sim falado, meta de latência, tela bloqueada/foco), propor prioridade e avaliar dividir a entrega (extração do áudio compartilhado, voz no chat, modo de voz, celular). <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejamento: desenhar as quatro fatias (áudio compartilhado, voz no chat, modo de voz, celular), a origem "voz" no turno da persona e a fala por frase sobre o texto ao vivo; confirmar no código o comportamento de hoje, que veio só da triagem. Tratar as regras 11, 12 e 13 como propostas a confirmar. <!-- handoff:20 -->
- Passagem tl-experiencia → pessoa: Implementação: seguir 2_PLAN.md na ordem das entregas 1 a 5, um commit por entrega, todos passando em tsc, vitest, theme-audit, i18n:lint e public-audit. Começar pela Entrega 1 (dividir audio.ts em voice/ com reexport, callback de silêncio com motivo e heard) e provar que as cerimônias não mudaram. Na Entrega 2, conferir antes de tudo que o campo origin sobrevive ao armazenamento do fórum. Toda lógica nova em funções puras, porque o vitest roda em ambiente node, sem jsdom. Verificar na hora: onde abrir as configurações de voz (seção/âncora), o canal de log do renderer para a linha de latência … <!-- handoff:33 -->
- Passagem dev-experiencia → revisor-experiencia: Revisão/teste: o código das cinco entregas e os 12 testes novos estão na worktree; tsc, i18n:lint, public-audit e theme-audit passam, e os testes de voz também. Na suíte inteira, as falhas que restam são só dos testes do navegador (falta o pacote local @playwright/mcp). Falta verificar com o app rodando e a voz instalada: microfone no chat, modo de voz (estados, legendas, silenciar, encerrar, Ctrl/Cmd+Shift+M), fala antes do fim do texto, barge-in, a linha de latência no console (meta de 3 s), aviso com a voz desligada, e o celular com e sem https. electron-vite build não foi rodado. <!-- handoff:69 -->
- Passagem qa-experiencia → integrator: Integração: gates verdes (tsc, auditorias, 154 testes de voz); suíte inteira só falha nos 4 arquivos do navegador (falta @playwright/mcp). Antes de abrir o PR, ressalvar que app com voz, latência, celular e electron-vite build não foram verificados. <!-- handoff:90 -->
- Passagem integrator → dev-experiencia: Integração: devolver. A branch está 11 commits atrás de origin/release/0.11.0 e a mesclagem de teste dá conflito em CHANGELOG.md. Os demais itens passam: esquema 34 igual ao da release, gates, build e nomes de módulo novos. Cenário que falhou: Base atualizada com a release aberta. 11 commits atrás de origin/release/0.11.0; merge-tree acusa conflito em CHANGELOG.md. <!-- handoff:110 -->
- Passagem dev-experiencia → revisor-experiencia: Integração: trazer origin/release/0.11.0 pela ferramenta de conflito do app (a branch está 11 commits atrás). O conflito é só em CHANGELOG.md, e o lado da release nele ficou vazio: a resolução é manter o arquivo da branch como está. Fora de [Unreleased], ele já é idêntico ao da release, com o bloco beta.5 e os links (ev-4). Depois da mesclagem, rodar de novo tsc e os testes de voz, conferir o esquema 34 e então abrir o PR com base release/0.11.0. Na descrição, ressalvar que o app com voz, a latência e o celular não foram verificados. <!-- handoff:127 -->
- Passagem revisor-experiencia → qa-experiencia: Integração: trazer origin/release/0.11.0 pela ferramenta de conflito do app (conflito só em CHANGELOG.md; manter o arquivo da branch), rodar de novo tsc e os testes de voz, conferir esquema 34 e abrir o PR com base release/0.11.0, ressalvando que app com voz, latência e celular não foram verificados. <!-- handoff:133 -->
- Passagem qa-experiencia → integrator: Integração: trazer origin/release/0.11.0 pela ferramenta de conflito do app (só CHANGELOG.md conflita; manter o arquivo da branch), repetir tsc e testes de voz, e abrir o PR com base release/0.11.0 ressalvando app com voz, latência e celular não verificados. <!-- handoff:145 -->

# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, sem duplicada, squad experiencia. Refinamento: priority:medium, sem marco; propostas 11 ("sim" falado só sem efeito externo), 12 (meta 3 s, medir, débito não bloqueia), 13 (computador segue ouvindo; celular pausa ao bloquear/trocar de aba) valem como escritas. Aviso de privacidade do Edge nas configurações de voz (regra 14).
- Plano (2_PLAN.md): 5 entregas; todas implementadas, um commit só para a etapa.
- Sem canal IPC novo. Só o aparelho que enviou o turno fala a resposta. Voz da persona = voiceOfAgent(persona.id). Cerimônias não migradas.
- Configurações de voz abrem a tela settings (sem âncora); latência vai para console.info no renderer (linha i18n-ignore).
- Revisão: aprovado por leitura, 4 sugestões não bloqueantes. QA: gates verdes, nenhuma falha.
- Integração (7_INTEGRATION.md): devolvida só pela base (ver abaixo).

## Restrições

- Texto novo nos dois catálogos, `.novoice` onde disser "call"; cores só por tokens; testes com fakes.
- vitest em ambiente node, sem jsdom: lógica em funções puras.
- Voz desligada/não instalada: sem microfone nem download. Celular: gravação exige https; instalar/ligar voz só no computador.
- Nunca merge/rebase/commit pelo shell; base vem pela ferramenta de conflito do app. PR com base release/0.11.0, não main.

## Tentado e descartado

- params.origin em vez de campo próprio. Migrar telas que duplicam useTalk. Canal IPC novo para voz da persona.
- QA não abriu o app: sem voz instalada no ambiente.

## Perguntas abertas

- Pessoa confirmar propostas 11–13 (não bloqueia).
- Não verificado: app rodando com voz, latência real, lacunas entre frases, barge-in com eco, celular real, atalho Ctrl/Cmd+Shift+M, modelo seguir o prompt de voz, aparência do modo de voz, PRs abertos na release (esquema).
- 4 arquivos de teste do navegador falham por falta de @playwright/mcp (ambiente).

## Onde o trabalho está

- Integração conferiu: esquema 34 = release; theme-audit, i18n:lint, public-audit 0; electron-vite build ok; nomes de módulo novos sem colisão; CHANGELOG tem a linha.
- Bloqueio: branch 11 commits atrás de origin/release/0.11.0, conflito só em CHANGELOG.md. Próximo: trazer a base pelo app, reconferir tsc/testes de voz, voltar à integração e então abrir o PR.
- Passagem support → product-owner: Refinamento: decidir as três perguntas abertas (sim falado, meta de latência, tela bloqueada/foco), propor prioridade e avaliar dividir a entrega (extração do áudio compartilhado, voz no chat, modo de voz, celular). <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejamento: desenhar as quatro fatias (áudio compartilhado, voz no chat, modo de voz, celular), a origem "voz" no turno da persona e a fala por frase sobre o texto ao vivo; confirmar no código o comportamento de hoje, que veio só da triagem. Tratar as regras 11, 12 e 13 como propostas a confirmar. <!-- handoff:20 -->
- Passagem tl-experiencia → pessoa: Implementação: seguir 2_PLAN.md na ordem das entregas 1 a 5, um commit por entrega, todos passando em tsc, vitest, theme-audit, i18n:lint e public-audit. Começar pela Entrega 1 (dividir audio.ts em voice/ com reexport, callback de silêncio com motivo e heard) e provar que as cerimônias não mudaram. Na Entrega 2, conferir antes de tudo que o campo origin sobrevive ao armazenamento do fórum. Toda lógica nova em funções puras, porque o vitest roda em ambiente node, sem jsdom. Verificar na hora: onde abrir as configurações de voz (seção/âncora), o canal de log do renderer para a linha de latência … <!-- handoff:33 -->
- Passagem dev-experiencia → revisor-experiencia: Revisão/teste: o código das cinco entregas e os 12 testes novos estão na worktree; tsc, i18n:lint, public-audit e theme-audit passam, e os testes de voz também. Na suíte inteira, as falhas que restam são só dos testes do navegador (falta o pacote local @playwright/mcp). Falta verificar com o app rodando e a voz instalada: microfone no chat, modo de voz (estados, legendas, silenciar, encerrar, Ctrl/Cmd+Shift+M), fala antes do fim do texto, barge-in, a linha de latência no console (meta de 3 s), aviso com a voz desligada, e o celular com e sem https. electron-vite build não foi rodado. <!-- handoff:69 -->
- Passagem qa-experiencia → integrator: Integração: gates verdes (tsc, auditorias, 154 testes de voz); suíte inteira só falha nos 4 arquivos do navegador (falta @playwright/mcp). Antes de abrir o PR, ressalvar que app com voz, latência, celular e electron-vite build não foram verificados. <!-- handoff:90 -->

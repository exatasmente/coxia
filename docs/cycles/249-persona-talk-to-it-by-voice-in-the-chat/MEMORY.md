# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, sem duplicada, squad experiencia. Refinamento: priority:medium, sem marco; propostas 11 ("sim" falado só sem efeito externo), 12 (meta 3 s, medir, débito não bloqueia), 13 (computador segue ouvindo; celular pausa ao bloquear/trocar de aba) valem como escritas. Aviso de privacidade do Edge nas configurações de voz (regra 14).
- Plano (2_PLAN.md): 5 entregas (áudio compartilhado em src/renderer/src/voice/ com audio.ts reexportando; origem "voz" + prompt; voz no chat; modo de voz; celular). Implementadas todas; o app faz um commit só para a etapa, não um por entrega.
- Sem canal IPC novo. Só o aparelho que enviou o turno fala a resposta. Voz da persona = voiceOfAgent(persona.id). Cerimônias e suas telas duplicadas não migradas.
- Implementação: configurações de voz abrem a tela settings (sem âncora); latência vai para console.info no renderer (não há canal de log do renderer), linha marcada i18n-ignore.

## Restrições

- Texto novo nos dois catálogos (en e pt-BR), `.novoice` onde disser "call"; cores só por tokens; testes com fakes.
- vitest roda em ambiente node, sem jsdom: lógica em funções puras (voiceLoop, voiceTurns, sentences, speechFeed, voiceGate, latency, shortcut, pausePolicy, micSupport).
- Voz desligada/não instalada: sem microfone nem download; aviso com caminho para as configurações. Celular: gravação exige https; instalar/ligar voz só no computador.

## Tentado e descartado

- params.origin em vez de campo próprio. Migrar as telas que duplicam useTalk. Canal IPC novo para voz da persona.

## Perguntas abertas

- Pessoa confirmar as propostas 11–13 (não bloqueia).
- Não verificado: app rodando com voz instalada (nenhuma tela aberta na implementação), latência real, lacunas entre frases, barge-in com eco, celular real, colisão de Ctrl/Cmd+Shift+M, o modelo seguir o prompt de voz, "fala desligada não sintetiza" (só no hook, sem teste), electron-vite build.
- Testes do navegador (browser-quit, browser-sites, browser-contract, browser-runtime) falham na worktree por falta de @playwright/mcp em node_modules: ambiente, não a mudança.

## Onde o trabalho está

- Triagem, 1_SPEC.md, 2_PLAN.md e 3_IMPLEMENTATION.md prontos. Código e 12 testes novos (voice-*, forum-origin, persona-voice-prompt) na worktree; tsc, i18n:lint, public-audit, theme-audit e os testes de voz passam (ev-1). Docs voice.md, persona.md e CHANGELOG atualizados.
- Próxima etapa: revisão/teste com o app rodando e a voz instalada, cobrindo os critérios 1–3, 5, 8, 10–12 e medindo a latência.
- Passagem dev-experiencia → próxima etapa: verificar no app o microfone no chat, o modo de voz (estados, legendas, silenciar, encerrar, atalho), fala antes do fim do texto, barge-in, linha de latência no console, aviso com a voz desligada e celular com/sem https; rodar electron-vite build. <!-- handoff:impl -->
- Passagem support → product-owner: Refinamento: decidir as três perguntas abertas (sim falado, meta de latência, tela bloqueada/foco), propor prioridade e avaliar dividir a entrega (extração do áudio compartilhado, voz no chat, modo de voz, celular). <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejamento: desenhar as quatro fatias (áudio compartilhado, voz no chat, modo de voz, celular), a origem "voz" no turno da persona e a fala por frase sobre o texto ao vivo; confirmar no código o comportamento de hoje, que veio só da triagem. Tratar as regras 11, 12 e 13 como propostas a confirmar. <!-- handoff:20 -->
- Passagem tl-experiencia → pessoa: Implementação: seguir 2_PLAN.md na ordem das entregas 1 a 5, um commit por entrega, todos passando em tsc, vitest, theme-audit, i18n:lint e public-audit. Começar pela Entrega 1 (dividir audio.ts em voice/ com reexport, callback de silêncio com motivo e heard) e provar que as cerimônias não mudaram. Na Entrega 2, conferir antes de tudo que o campo origin sobrevive ao armazenamento do fórum. Toda lógica nova em funções puras, porque o vitest roda em ambiente node, sem jsdom. Verificar na hora: onde abrir as configurações de voz (seção/âncora), o canal de log do renderer para a linha de latência … <!-- handoff:33 -->

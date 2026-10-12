# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, sem duplicada, squad experiencia. Refinamento: priority:medium, sem marco; propostas 11 ("sim" falado só sem efeito externo), 12 (meta 3 s, medir, débito não bloqueia), 13 (computador segue ouvindo; celular pausa ao bloquear/trocar de aba) valem como escritas. Aviso de privacidade do Edge nas configurações de voz (regra 14).
- Plano (2_PLAN.md): 5 entregas (áudio compartilhado em src/renderer/src/voice/ com audio.ts reexportando; origem "voz" + prompt; voz no chat; modo de voz; celular). Implementadas todas; um commit só para a etapa.
- Sem canal IPC novo. Só o aparelho que enviou o turno fala a resposta. Voz da persona = voiceOfAgent(persona.id). Cerimônias não migradas.
- Implementação: configurações de voz abrem a tela settings (sem âncora); latência vai para console.info no renderer, linha marcada i18n-ignore.
- Revisão (4_REVIEW.md): aprovado por leitura do diff, sem bloqueantes; 4 sugestões (teste de fala desligada no sayStream, latência só no console, marca de latência acoplada a player.speaking, módulo próprio para stateText/GateNote).

## Restrições

- Texto novo nos dois catálogos (en e pt-BR), `.novoice` onde disser "call"; cores só por tokens; testes com fakes.
- vitest roda em ambiente node, sem jsdom: lógica em funções puras.
- Voz desligada/não instalada: sem microfone nem download; aviso com caminho para as configurações. Celular: gravação exige https; instalar/ligar voz só no computador.

## Tentado e descartado

- params.origin em vez de campo próprio. Migrar as telas que duplicam useTalk. Canal IPC novo para voz da persona.

## Perguntas abertas

- Pessoa confirmar as propostas 11–13 (não bloqueia).
- Não verificado (nem na revisão): app rodando com voz instalada, latência real, lacunas entre frases, barge-in com eco, celular real, colisão de Ctrl/Cmd+Shift+M, o modelo seguir o prompt de voz, electron-vite build. Gates (tsc, vitest, auditorias) vêm do relato da implementação, não reexecutados na revisão.
- Testes do navegador falham na worktree por falta de @playwright/mcp: ambiente.

## Onde o trabalho está

- Triagem, spec, plano, implementação e revisão (4_REVIEW.md, aprovado) prontos. Código e 12 testes novos na worktree; docs voice.md, persona.md e CHANGELOG atualizados.
- Próxima etapa: teste com o app rodando e voz instalada (critérios 1–3, 5, 8, 10–12, medir latência) e integração.
- Passagem support → product-owner: Refinamento: decidir as três perguntas abertas (sim falado, meta de latência, tela bloqueada/foco), propor prioridade e avaliar dividir a entrega (extração do áudio compartilhado, voz no chat, modo de voz, celular). <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejamento: desenhar as quatro fatias (áudio compartilhado, voz no chat, modo de voz, celular), a origem "voz" no turno da persona e a fala por frase sobre o texto ao vivo; confirmar no código o comportamento de hoje, que veio só da triagem. Tratar as regras 11, 12 e 13 como propostas a confirmar. <!-- handoff:20 -->
- Passagem tl-experiencia → pessoa: Implementação: seguir 2_PLAN.md na ordem das entregas 1 a 5, um commit por entrega, todos passando em tsc, vitest, theme-audit, i18n:lint e public-audit. Começar pela Entrega 1 (dividir audio.ts em voice/ com reexport, callback de silêncio com motivo e heard) e provar que as cerimônias não mudaram. Na Entrega 2, conferir antes de tudo que o campo origin sobrevive ao armazenamento do fórum. Toda lógica nova em funções puras, porque o vitest roda em ambiente node, sem jsdom. Verificar na hora: onde abrir as configurações de voz (seção/âncora), o canal de log do renderer para a linha de latência … <!-- handoff:33 -->
- Passagem dev-experiencia → revisor-experiencia: Revisão/teste: o código das cinco entregas e os 12 testes novos estão na worktree; tsc, i18n:lint, public-audit e theme-audit passam, e os testes de voz também. Na suíte inteira, as falhas que restam são só dos testes do navegador (falta o pacote local @playwright/mcp). Falta verificar com o app rodando e a voz instalada: microfone no chat, modo de voz (estados, legendas, silenciar, encerrar, Ctrl/Cmd+Shift+M), fala antes do fim do texto, barge-in, a linha de latência no console (meta de 3 s), aviso com a voz desligada, e o celular com e sem https. electron-vite build não foi rodado. <!-- handoff:69 -->

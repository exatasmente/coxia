# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, sem duplicada, squad experiencia. Refinamento: priority:medium, sem marco; propostas 11 ("sim" falado só sem efeito externo), 12 (meta 3 s, medir, débito não bloqueia), 13 (computador segue ouvindo; celular pausa ao bloquear/trocar de aba) valem como escritas. Aviso de privacidade do Edge nas configurações de voz (regra 14).
- Plano (2_PLAN.md, lido no código, nada executado): 5 entregas, um commit cada: (1) áudio compartilhado: audio.ts vira pasta src/renderer/src/voice/ com audio.ts reexportando; callback de silêncio com {reason, heard}; micSupport puro; (2) origem "voz": campo origin?: 'voice' em ForumMessage, 3º argumento de forum:post, linha de prompt `prompt.sdd.runner.mention.persona.voice` (curto, sem markdown, anúncio de ação longa, "sim" falado não autoriza); (3) voz no chat: separador de frases puro, player.sayStream (fila de frases), rastreador de turnos, gate de voz, controles no Composer via prop extra, aviso do Edge; (4) modo de voz: voiceLoop (máquina de estados pura), tela {name:'voice'}, atalho Ctrl/Cmd+Shift+M; (5) celular: mensagens de https/permissão, pausa por visibilitychange, wakeLock, entrada principal.
- Sem canal IPC novo (nenhuma mudança em webPolicy nem nos testes de política). Só o aparelho que enviou o turno fala a resposta. Voz da persona = voiceOfAgent(persona.id). Cerimônias e suas telas duplicadas (Call/Gate/Conflict/Deep) não são migradas.

## Restrições

- Texto novo nos dois catálogos (en e pt-BR), `.novoice` onde disser "call"; cores só por tokens; testes com fakes.
- vitest roda em ambiente node, sem jsdom: toda lógica nova em funções puras (como barge.ts).
- Voz desligada/não instalada: sem microfone nem download; aviso com caminho para as configurações. Celular: gravação exige https; instalar/ligar voz fica só no computador.
- VAD só para por silêncio depois de ouvir fala; sem fala, para em 30 s: mãos livres precisa descartar sem transcrever.

## Tentado e descartado

- params.origin em vez de campo próprio (mistura com dado de apresentação). Migrar as telas que duplicam useTalk (quebraria "cerimônias não mudam"). Canal IPC novo para voz da persona.

## Perguntas abertas

- Pessoa confirmar as propostas 11–13 (não bloqueia).
- Conferir na implementação: origin sobrevive ao armazenamento do fórum; âncora das configurações de voz; canal de log do renderer para latência; teste que compara EXCLUSION_REASONS.voice; teste de prompts "voz só quando ligada".
- Não verificado: latência real, lacunas entre frases, barge-in com eco, celular real, o modelo seguir o prompt de voz.

## Onde o trabalho está

- Triagem, 1_SPEC.md e 2_PLAN.md prontos. Próxima etapa: implementação, entrega 1 primeiro (provar que cerimônias não mudaram).
- Passagem tl-experiencia → developer: seguir 2_PLAN.md na ordem, um commit por entrega, gates verdes; verificar os itens "conferir na implementação" acima. <!-- handoff:plan -->
- Passagem support → product-owner: Refinamento: decidir as três perguntas abertas (sim falado, meta de latência, tela bloqueada/foco), propor prioridade e avaliar dividir a entrega (extração do áudio compartilhado, voz no chat, modo de voz, celular). <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejamento: desenhar as quatro fatias (áudio compartilhado, voz no chat, modo de voz, celular), a origem "voz" no turno da persona e a fala por frase sobre o texto ao vivo; confirmar no código o comportamento de hoje, que veio só da triagem. Tratar as regras 11, 12 e 13 como propostas a confirmar. <!-- handoff:20 -->

# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, sem duplicada, squad experiencia.
- Refinamento (1_SPEC.md escrito): prioridade proposta priority:medium; sem marco (versão futura desconhecida). Entrega sugerida em 4 fatias: áudio compartilhado → voz no chat → modo de voz → celular.
- Propostas a confirmar (valem como escritas se não houver contra): (11) "sim" falado só para escolhas sem efeito externo; confirmações com efeito externo seguem por botão; (12) meta: primeira palavra em até 3 s após o fim da fala, medida e registrada no teste, passar vira débito; (13) computador segue ouvindo sem foco; celular pausa ao bloquear a tela/trocar de aba e retoma com toque.
- Aviso de privacidade do motor Edge nas configurações de voz (regra 14).

## Restrições

- Texto novo nos dois catálogos (en e pt-BR), com variante sem "call"; cores só por tokens de tema; testes com fakes.
- Voz desligada/não instalada: nada de microfone nem download; avisar e apontar para Configurações.
- Celular pareado: gravação depende de https; instalar/ligar voz fica bloqueado pela política web.
- Cerimônias de voz não mudam de comportamento ao usar o componente compartilhado.

## Tentado e descartado

- Nada.

## Perguntas abertas

- Pessoa confirmar as propostas 11–13 (não bloqueia).
- Depende da #247 (texto ao vivo) para a fala por frase.

## Onde o trabalho está

- Triagem e 1_SPEC.md prontos. Hoje (só lido na triagem, não reconferido): chat sem microfone nem fala; áudio (usePlayer/useRecorder/useTalk/bargeMonitor em audio.ts) só nas cerimônias; `persona:live` existe mas não liga ao player; prompt da persona sem turno de voz. Relacionadas: #245, #247, #248, #246. Próxima etapa: planejamento (confirmar o código).
- Passagem support → product-owner: Refinamento: decidir as três perguntas abertas (sim falado, meta de latência, tela bloqueada/foco), propor prioridade e avaliar dividir a entrega (extração do áudio compartilhado, voz no chat, modo de voz, celular). <!-- handoff:11 -->

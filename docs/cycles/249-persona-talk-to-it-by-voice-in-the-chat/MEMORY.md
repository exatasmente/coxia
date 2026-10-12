# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, entendível como escrito (só lido, nada executado). Sem duplicada. Squad proposto: experiencia. Prioridade sugerida: medium (decide o refinamento).

## Restrições

- Texto novo nos dois catálogos (en e pt-BR), com variante sem voz onde houver "call"; cores só por tokens de tema; testes com fakes.
- Voz desligada/não instalada: nada de microfone nem download; avisar e apontar para Configurações.
- Celular pareado: gravação depende de https; instalar/ligar voz fica bloqueado pela política web.

## Tentado e descartado

- Nada.

## Perguntas abertas

- "Sim" falado basta para confirmações? (sugestão: ações que mudam algo externo seguem por botão)
- Meta de latência fim da fala → primeira palavra.
- Comportamento com tela bloqueada/perda de foco (sem wakeLock nem visibilitychange hoje).

## Onde o trabalho está

- Triagem pronta (0_TRIAGE.md). Hoje: chat da persona sem microfone, sem fala, sem modo de voz; áudio (usePlayer/useRecorder/useTalk/bargeMonitor em audio.ts) só nas cerimônias; texto ao vivo `persona:live` existe mas não liga ao player; prompt da persona sem noção de turno de voz. Relacionadas: #245, #247, #248, #246. Próxima etapa: refinamento.

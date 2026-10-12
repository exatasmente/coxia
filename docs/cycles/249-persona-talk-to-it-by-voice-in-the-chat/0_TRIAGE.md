# Triagem: voz no chat da persona e modo de voz

## Tipo
Pedido de funcionalidade (parte do épico #245). Não é bug, pergunta nem duplicada.

## Dá para entender?
Sim, como está escrita: o comportamento esperado e os cinco critérios de aceite são claros. Conferido **só por leitura** da issue e do código; nada foi executado nem reproduzido.

## Comportamento de hoje (lido no código)
- Existem gravador com detecção de silêncio, player frase a frase, atalho de falar (`useTalk`), barge-in e sidecar de voz, mas só as telas de cerimônia os usam (`src/renderer/src/audio.ts:321,421,531`, `bargeMonitor.ts`).
- O chat da persona não tem microfone, não fala as respostas e não tem modo de voz. O compositor só tem anexar e enviar (`screens/cycle/Composer.tsx`, usado em `screens/persona/ChatThread.tsx:126`). Na tela da persona só existe o interruptor de fala no cabeçalho (`ChatHeader.tsx:111`).
- O texto ao vivo da persona já chega ao renderer (`persona:live`, `src/shared/persona.ts:9`, `liveApi.ts:36`), mas nada o liga ao player. O player recebe o texto inteiro (`audio.ts:249`); não há fala por frase durante o stream.
- O prompt da persona não distingue turno de voz (`src/main/mentions/call.ts`); a limpeza de markdown só acontece na hora da síntese.
- Não há atalho global nem modo hands-free contínuo; o Espaço do `useTalk` é ignorado com foco no campo de texto.
- Voz desligada: a interface de microfone some em silêncio (`docs/voice.md:8`); a issue pede um aviso que aponte para as configurações.
- Celular pareado: `voice:transcribe`, `voice:segment` e `voice:plan` já passam pela política web; instalar/ligar/testar ficam bloqueados (`webPolicy.ts:17`). Não há checagem de contexto seguro; o microfone no celular depende de https (`config.ts:65`, `SECURITY.md:56`) e uma falha vira só "Microphone unavailable" (`audio.ts:481`). Sem wake lock nem tratamento de `visibilitychange`; o barge-in fica desligado no iOS (`bargeMonitor.ts:89`).
- A tabela de portas da persona marca voz como "issue futura" (`src/main/persona/doorTable.ts:265,287`).

## O que falta / pontos de atenção
Tudo abaixo é leitura, não verificado:
- As três perguntas abertas da issue seguem para o refinamento: "sim" falado como confirmação, meta de latência, tela bloqueada/perda de foco.
- Sugestão (não decisão): confirmações de ação que muda algo fora da máquina continuarem por botão, dado o compromisso do README de nunca mudar nada externo sem "sim" explícito e o risco de transcrição errada ou eco da própria voz.
- Privacidade: com o motor Edge, o texto falado vai para a Microsoft (`docs/voice.md:56`); falar as respostas da persona aumenta esse volume.
- Quem migrou com voz ligada ganha o microfone no chat sem pedir.
- Texto novo nos dois catálogos (en e pt-BR), com variante sem voz onde aparecer "call" (`docs/i18n.md`); docs de voz/persona e CHANGELOG a atualizar.
- Escopo grande: extração do código compartilhado, tela nova, fala por frase, prompt de turno de voz, mesma conversa, celular. Sugestão de dividir em entregas no refinamento.

## Issues relacionadas (não duplicadas)
- #245: épico pai.
- #247: conversa/chat da persona e texto ao vivo, onde a voz entra.
- #248: ferramentas e porta da persona; turno de voz precisa de origem, e a pergunta do "sim" falado toca as confirmações dela.
- #246: pergunta à pessoa no limite de passos, mesmo mecanismo de espera por resposta.
- #269/#268: política de autonomia e auditoria, afetadas só se confirmação por voz for permitida.
- Cerimônias de voz anteriores (#16, #53, #164): fonte do código a reaproveitar, sem sobreposição.

## Sugestões (não decisões)
- Prioridade: **priority:medium**, por ser entrega grande do épico, sem urgência de falha; a decisão é do refinamento.
- Squad: experiencia (telas, voz, catálogos).

## Pergunta a quem abriu
Nenhuma: o que falta são decisões de produto já listadas na própria issue.

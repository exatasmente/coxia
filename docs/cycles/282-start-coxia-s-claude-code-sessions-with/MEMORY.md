# Memória do ciclo

## Decisões
- Resposta: C <!-- answer:68 -->
- Resposta: 1 <!-- answer:85 -->

## Restrições

## Tentado e descartado

## Perguntas abertas

## Onde o trabalho está
- Passagem support → product-owner: Especificação: verificar no SDK se uma sessão iniciada pelo Agent SDK abre a ponte (remoteControlAtStartup/autoUploadSessions não verificados), definir nível por agente vs por run, espelho só de leitura, e a dependência da issue de sessões (sem ciclo). Pontos de entrada: src/main/agents.ts sdkOptions, src/main/webPolicy.ts DESKTOP_ONLY/PERSONA_UNLISTED, auditoria da #268. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejamento: primeiro verificar no SDK se uma sessão não interativa abre a ponte e se há espelho só de leitura; definir a precedência agente x execução; apoiar-se em sdkOptions (agents.ts), DESKTOP_ONLY/PERSONA_UNLISTED (webPolicy.ts), recusa em test:true e o mecanismo de auditoria da #268. Registrar a dependência da issue de sessões. <!-- handoff:20 -->
- Passagem tl-plataforma → pessoa: Implementação: executar primeiro a etapa 0 (sondagem do SDK: ponte em sessão não interativa e espelho só de leitura) e registrar o resultado; se a ponte não abrir, parar e devolver ao product owner o comportamento alternativo (regra 12). Só então seguir 1 a 6 e 8 de 2_PLAN.md. Verificar como a auditoria das ações autônomas (#268) pode registrar um evento que não é escrita no host de código. A tela de sessões (item 7) fica fora até a issue de sessões existir. <!-- handoff:33 -->

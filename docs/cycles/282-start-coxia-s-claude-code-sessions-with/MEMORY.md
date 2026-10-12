# Memória do ciclo

## Decisões

- Resposta: C <!-- answer:68 -->
- Resposta: 1 <!-- answer:85 -->: seguir pela API `./bridge` (alpha) do SDK, com sondagem com login antes do código.
- Revisão (rodada 1): veredito "mudanças"; a branch só tem documentos, nenhum critério atendido; volta ao planejamento.
- Implementação (tentativa 3): sem código, porque o plano não foi revisado; devolvida à tl-plataforma.

## Restrições

- Regra 12 da spec: não ofertar a opção como se funcionasse; sem ponte, o comportamento alternativo é decidido antes.
- Persona, celular pareado e `test: true` nunca ligam; auditoria de uma linha por sessão (id de createCodeSession).
- A tela de sessões (critério 9) depende de uma issue sem ciclo; fica fora desta entrega.
- API `./bridge` é alpha: isolar atrás de um módulo único e testar com fake.

## Tentado e descartado

- `remoteControlAtStartup` + `--remote-control` no `query()` do SDK: a sessão fica viva, mas nenhuma ponte abre (ev-1, ev-4). Descartado.

## Perguntas abertas

- Origem do token OAuth (credencial do Claude Code ou login próprio).
- Recusa visível no espelho: a página fica em "executando", e o critério 3 como escrito não é atendido sem mensagem fixa ou reescrita.
- A entrada do modo control passa pelas aprovações do Coxia?
- Comportamento em untrusted_device, session_stale_relogin e oauth_rejected (proposta: rodar sem ponte e registrar).
- Arquivar as sessões no fim; filtro do que é repassado a claude.ai; renovação da credencial (46800 s).
- Como a auditoria da #268 registra um evento que não é escrita no host de código (não verificado).

## Onde o trabalho está

- Sondagem feita (ev-6 mirror: 0 entradas; ev-7 control: mensagem e Parar chegam; ev-8 script). Nenhum código de produto nem portão rodado.
- O 2_PLAN.md ainda traz os passos 3 e 4 antigos; a tl-plataforma precisa refazê-los e fixar as decisões acima. Os passos 1, 2, 5, 6 e 8 continuam valendo.
- Duas sessões de teste continuam na conta da pessoa.
- Passagem support → product-owner: Especificação: verificar no SDK se uma sessão iniciada pelo Agent SDK abre a ponte (remoteControlAtStartup/autoUploadSessions não verificados), definir nível por agente vs por run, espelho só de leitura, e a dependência da issue de sessões (sem ciclo). Pontos de entrada: src/main/agents.ts sdkOptions, src/main/webPolicy.ts DESKTOP_ONLY/PERSONA_UNLISTED, auditoria da #268. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejamento: primeiro verificar no SDK se uma sessão não interativa abre a ponte e se há espelho só de leitura; definir a precedência agente x execução; apoiar-se em sdkOptions (agents.ts), DESKTOP_ONLY/PERSONA_UNLISTED (webPolicy.ts), recusa em test:true e o mecanismo de auditoria da #268. Registrar a dependência da issue de sessões. <!-- handoff:20 -->
- Passagem tl-plataforma → pessoa: Implementação: executar primeiro a etapa 0 (sondagem do SDK: ponte em sessão não interativa e espelho só de leitura) e registrar o resultado; se a ponte não abrir, parar e devolver ao product owner o comportamento alternativo (regra 12). Só então seguir 1 a 6 e 8 de 2_PLAN.md. Verificar como a auditoria das ações autônomas (#268) pode registrar um evento que não é escrita no host de código. A tela de sessões (item 7) fica fora até a issue de sessões existir. <!-- handoff:33 -->
- Passagem developer → revisor-plataforma: Planejamento (tl-plataforma): revisar 2_PLAN.md com o resultado da sondagem (3_IMPLEMENTATION.md, ev-6/ev-7). O passo 3 muda: a ponte é aberta pelo processo principal do Coxia pela API `./bridge` (createCodeSession → fetchRemoteCredentials → attachBridgeSession com outboundOnly para mirror → write() de cada mensagem do query() → close), não por sdkOptions. A auditoria usa o id devolvido por createCodeSession. Faltam decidir: (1) a origem do token (ler a credencial que o Claude Code já guarda, ou login próprio); (2) a recusa visível no espelho, porque a página aceita a mensagem e fica em "execu… <!-- handoff:117 -->
- Passagem revisor-plataforma → developer: Não há código de produto para aprovar: a branch só tem documentos do ciclo, e a implementação fez apenas a sondagem da API de ponte. O resultado dela invalida o passo 3 do plano e deixa cinco decisões abertas. Veredito: mudanças, devolvendo ao planejamento. [bloqueia] docs/cycles/[redacted]/2_PLAN.md: O passo 3 (opção do SDK em sdkOptions) e o passo 4 (auditoria) estão invalidados pela sondagem: passar opção ao query() não abre a ponte; a ponte é aberta pelo processo principal via API ./bridge, e o id da auditoria vem de createCodeSession. Cinco decisões de segurança (origem do token, recusa n… <!-- handoff:127 -->

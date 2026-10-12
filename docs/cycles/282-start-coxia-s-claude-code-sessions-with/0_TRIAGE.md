# Triagem: Remote Control opcional nas sessões do Claude Code do Coxia

## Tipo

Pedido de funcionalidade (não é bug, pergunta nem duplicada). É a entrega 5 da #262, separada em issue própria.

## Dá para entender?

Sim, como está escrita. Conferido apenas por leitura da issue, de documentos de ciclos vizinhos e de buscas no código; nada foi executado nem reproduzido. Os critérios de aceitação são testáveis em sua maior parte (sessão aparece ou não aparece em claude.ai/code; espelho só de leitura recusa entrada; workspace `test: true` recusa; uma linha de auditoria por sessão aberta).

O que a issue afirma sobre o SDK (`remoteControlAtStartup`, `autoUploadSessions`, como abrir a ponte numa sessão iniciada pelo Agent SDK) **não foi verificado**; a própria issue manda o plano descobrir isso. Se o SDK não permitir abrir a ponte em sessão não interativa, a entrega muda de forma: é o principal risco técnico.

## Conferido no código (só leitura)

- Nenhuma ocorrência de Remote Control, `remoteControlAtStartup` ou `autoUploadSessions` em `src/`.
- `src/main/agents.ts:493-531` (`sdkOptions`): as etapas isoladas usam `settingSources: []` e `settings: { autoMemoryEnabled: false }` (linha 524), então configurações do Claude Code não chegam a elas; qualquer opção teria de ser passada pelo app.
- Não há tela de sessões, fork de sessão nem "retomar no terminal" em `src/` (busca por `forkSession` e tela de sessões sem resultado). A issue depende dessas entregas, que ainda não existem; não há ciclo para elas em `docs/cycles/`.
- `src/main/webPolicy.ts:120`: canais só-desktop ficam em `DESKTOP_ONLY` e são negados ao celular; é o lugar natural para "o interruptor só existe no desktop" e para a persona (`PERSONA_UNLISTED`). Não aprofundado.
- Workspace de teste existe como `test: true` (`src/main/workspaces-core.ts:154`); a recusa em si não foi localizada nesta etapa.

## O que falta

Nada que bloqueie. Para a especificação, a decidir (sem pergunta nova a quem abriu):

- Confirmar no SDK se e como uma sessão iniciada por ele abre a ponte; fallback se não der.
- Onde fica a opção: por agente e por run são dois níveis; qual vence em caso de conflito.
- Se o espelho só de leitura é suportado de fato pelo Claude Code ou precisa de outro mecanismo.
- Ordem: depende da issue de sessões (entregas 1 e 2 da #262), ainda sem ciclo.

## Relacionadas

- #262 (guarda-chuva): a entrega 5 tem texto quase igual; a #282 é a divisão dela, não duplicada. A especificação da entrega 4 deixou o Remote Control fora de escopo.
- Issue de sessões (entregas 1 e 2 da #262): dependência; número não encontrado nos documentos.
- #270 e #269: tocam a fronteira persona/celular/aprovações que o Remote Control contorna; relacionadas, não duplicadas.
- #157: regra do celular pareado que só observa; é a garantia que o Remote Control atravessa.
- #268: auditoria de passos autônomos; o registro de cada sessão aberta com Remote Control deve seguir o mesmo mecanismo (não verificado).
- #181 (sessão do Claude Code fora do app): só o nome bateu; não lida.

## Sugestões (não são decisões)

- Prioridade: `priority:medium`. Risco de segurança alto, mas é opt-in, desligado por padrão, e depende de outra entrega.
- Squad: plataforma (runner, motores, config, `webPolicy.ts`, auditoria, fronteira de segurança); o aviso e os controles na tela de sessões ficam com experiência, e os textos entram nos dois catálogos de idioma.
- Riscos para o plano: ligar só no desktop; nunca ofertar ao celular nem à persona; recusar em `test: true`; aviso claro de que contorna as regras do celular pareado, sandbox e aprovações; uma linha de auditoria por sessão.

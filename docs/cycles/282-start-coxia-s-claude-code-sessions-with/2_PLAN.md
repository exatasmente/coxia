# Plano: Remote Control opcional nas sessões do Claude Code

Base: spec aprovada (12 regras, 10 critérios). Lido nesta etapa: `src/main/agents.ts` (`sdkOptions`, chamadas com `isolated: true`), `src/main/engine/contract.ts` (`EngineRequest`), `src/main/webPolicy.ts` (`webAccess`, `DESKTOP_ONLY`, `PERSONA_UNLISTED`), `src/shared/config/types.ts` (`AgentToolsConfig`, config de agente), `src/shared/config/migrations.ts` (`STEPS`, último passo v33→v34), `src/main/workspaces-core.ts` (campo `test`) e `src/main/actions.ts` (`AuditOrigin`, `audited`). Nada foi executado. Não existe nenhuma ocorrência de `remoteControl`, `autoUploadSessions` ou `remote-control` no código.

## Estado do que é verificado

- Verificado por leitura: onde as opções do SDK são montadas, onde a política de canais mora, que o workspace tem `test: boolean`, que a config usa migrações numeradas.
- **Não verificado**: se uma sessão iniciada pelo Agent SDK abre a ponte e por qual mecanismo (opção do SDK, `settings`, variável de ambiente ou argumento da CLI); se existe espelho só de leitura; como a auditoria existente registra algo que não é escrita no host de código (`audited` em `actions.ts` foi lido só no cabeçalho).
- Dependência: a tela de sessões, a bifurcação e a retomada no terminal (entregas 1 e 2 da #262) não existem e não têm ciclo.

## Decisões

1. **Etapa 0 é uma sondagem, e ela decide o resto.** Antes de qualquer código de produto, um teste manual com o SDK instalado (sessão não interativa, `settingSources: []`) responde: a ponte abre? por qual opção? o espelho de leitura existe? A resposta vai para o documento do ciclo. Motivo: a spec (regra 12) proíbe ofertar a opção como se funcionasse.
2. **Precedência: a execução só restringe.** Valor efetivo = o mais restritivo entre agente e execução, com `off` < `mirror` < `control`; a execução nunca liga onde o agente está desligado. Motivo: é a proposta da spec e a mais segura; a tela mostra qual valeu (critério 10). Se o product owner discordar, só muda a função de resolução (um ponto).
3. **Três níveis, não um booleano:** `off` (padrão), `mirror` (só leitura) e `control`. Se a sondagem mostrar que `mirror` não existe, o nível sai do tipo e da interface (regra 9 vira não ofertada, dita no resumo).
4. **Política num módulo puro** (`src/main/remoteControl.ts`), sem I/O, para que recusas (`test: true`, origem, persona) sejam testáveis sem SDK.
5. **A opção chega ao SDK por um campo novo de `EngineRequest`**, não por `extra`: `extra` é aberto (`...req.extra` por último em `sdkOptions`) e qualquer chamador poderia ligar a ponte sem passar pela política.
6. **Persona não liga, por construção:** nenhuma chamada da persona preenche o campo, e nenhum canal da persona o expõe. Um teste fixa que a requisição da persona sai sem ele.
7. **Auditoria: uma linha por sessão aberta**, gravada no momento em que a sessão começa, pelo mesmo caminho de auditoria das ações autônomas (#268), com tipo novo `remote-control`. Reutilizar o caminho exato é a verificar na etapa de implementação (não verificado hoje); se `audited` for acoplado ao host de código, usa-se o sink de auditoria de `src/main/browser/audit.ts` (`AuditSink`) como modelo.

## Mudanças, em ordem

### 0. Sondagem (sem commit de produto)
Teste manual com o SDK: sessão não interativa abre a ponte? opção/ambiente/argumento? espelho? Registrar no ciclo. **Se não abrir:** parar e devolver ao product owner o comportamento alternativo (regra 12). As etapas 1 a 6 só começam com a resposta.

### 1. Política pura
- `src/main/remoteControl.ts` (novo): `resolveRemoteControl({ agent, run, workspace, origin })` → `{ mode, decidedBy: 'agent'|'run'|'default', refusal?: string }`. Recusa quando `workspace.test === true` (regra 6), quando `origin` é `phone` ou `persona` (regras 4 e 5), ou quando o nível pedido não é suportado (resultado da sondagem).
- Texto da recusa vem de `t()`.

### 2. Configuração (regra do repositório: tipos, padrões, esquema e migração juntos)
- `src/shared/config/types.ts`: `remoteControl?: 'off' | 'mirror' | 'control'` no agente da equipe; mesmo tipo reaproveitado no pedido de execução.
- `src/shared/config/defaults.ts`: padrão `off` em todo agente do sistema.
- `src/shared/config/schema.ts`: enum com padrão `off`.
- `src/shared/config/migrations.ts`: novo passo `v34ToV35` em `STEPS` (chave 34) que acrescenta `off` aos agentes existentes (critério 2); subir a versão do esquema.
- Edição só no desktop: o campo não entra em `WEB_EDITABLE` (a lista de campos que o navegador pareado pode editar).

### 3. Ligação ao motor
- `src/main/engine/contract.ts`: campo `remoteControl?: 'mirror' | 'control'` em `EngineRequest`, com comentário do porquê.
- `src/main/agents.ts`, `sdkOptions`: quando o campo existe, acrescentar a opção que a sondagem apontou, depois de `...req.extra`? **Não**: antes, e o campo vence (um `extra` não pode desligar nem trocar o nível decidido). Sem o campo, nada é passado (garante "desligado = nenhuma sessão").
- Ponto de chamada de etapas de execução (chamada com `isolated: true`, `agents.ts` ~1646): resolver a política e preencher o campo; recusa vira log e a etapa roda sem ponte (a execução não falha por causa disso).
- Chamadas de cerimônia e demais: só se a regra de escolha por agente se aplicar a elas; por padrão ficam sem o campo.

### 4. Auditoria
- Ao iniciar sessão com o campo preenchido, uma linha: agente, nível, execução/issue, id da sessão. Nunca uma linha para sessão sem ponte nem duas para a mesma sessão (retomadas do mesmo id não duplicam: chave de deduplicação pelo id da sessão).

### 5. Fronteira de segurança (`webPolicy.ts`)
- Novo conjunto `REMOTE_CONTROL_CHANNELS` e padrão `REMOTE_CONTROL_ADMIN = /^remoteControl:/` em `DESKTOP_ONLY`-style dentro de `webAccess`: negado ao navegador pareado, sem exceção nomeada (regra 4, critério 5). Segue o estilo de `MCP_STATE_ADMIN`.
- Canais `persona:*` não mudam; `PERSONA_UNLISTED` já fecha canal novo sob `persona:`; nenhum é criado.

### 6. Interface (desktop)
- Seletor `off / só leitura / controle` no editor de agente (`src/renderer/src/screens/team/`) e na tela de iniciar execução, com o aviso visível antes da confirmação (regra 8): ligar contorna as regras do celular pareado, o sandbox e as aprovações. Texto indica qual valeu (critério 10).
- Textos novos nos dois catálogos (`en` e `pt-BR`), tokens de tema, nada de cor literal.
- Oculto/desabilitado com motivo em workspace `test: true`.

### 7. Tela de sessões (condicionada)
Ligar para uma sessão e retomar no terminal (regra 10, critério 9) **só depois** da issue de sessões. Este plano deixa o ponto de extensão (`resolveRemoteControl` com `origin: 'sessions'`) pronto, mas não cobre o critério 9 nem a parte "sessão solta" do critério 8. Dito aqui para não parecer coberto.

### 8. Documentação
`CHANGELOG.md` (`Unreleased`), `docs/` do runtime onde as opções do motor são descritas, e `AGENTS.md` só se alguma instrução ficar falsa (não se espera).

## Testes (um por comportamento)

Todos com fakes; nenhum com SDK ou rede reais.

| Comportamento | Arquivo |
|---|---|
| Padrão `off`; migração v34→v35 acrescenta `off` e é idempotente (crit. 2) | `test/config-migrations.test.ts` |
| Precedência: execução só restringe; `decidedBy` correto (crit. 10) | `test/remote-control-policy.test.ts` |
| `test: true` recusa com motivo (crit. 4) | `test/remote-control-policy.test.ts` |
| Origem `phone`/`persona` recusada (crit. 5, 6) | `test/remote-control-policy.test.ts` |
| `sdkOptions` sem o campo não leva opção alguma de ponte; com o campo leva a de `mirror` e a de `control`; `extra` não sobrescreve | `test/agents-sdk-options.test.ts` (ou o arquivo existente que cobre `sdkOptions`) |
| Requisição da persona sai sem o campo (crit. 6) | `test/persona-remote-control.test.ts` |
| `remoteControl:*` negado ao navegador pareado, com e sem a chave de efeitos externos | `test/remote-control-policy-web.test.ts` (estilo de `test/memory-policy.test.ts`) |
| N sessões com ponte → N linhas de auditoria; sem ponte → zero; retomada não duplica (crit. 7) | `test/remote-control-audit.test.ts` |
| Os dois catálogos têm as chaves novas; aviso presente (crit. 8) | `npm run i18n:lint` + `test/i18n-remote-control.test.ts` |
| Seletor mostra aviso antes de confirmar e qual nível valeu | teste de componente do renderer, no estilo dos de `screens/team` |
| Critérios 1 e 3 (sessão aparece em claude.ai/code; espelho recusa entrada) | **só verificáveis com conta e SDK reais**: plano de QA manual, não teste automatizado. Não cobertos por testes do repositório. |

Portões antes de concluir: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`.

## Riscos e como se evitam

- **SDK não abre a ponte em sessão não interativa** (principal): etapa 0 decide antes de qualquer código; sem ponte, a opção não é ofertada.
- **Espelho só de leitura não existir:** nível `mirror` removido do tipo e da interface; critério 3 deixa de valer e isso é dito ao product owner.
- **Ponte ligada por brecha (`extra`, persona, celular):** campo próprio no motor, vencendo `extra`; testes fixam persona e canais; canal negado por padrão em `webAccess`.
- **Auditoria duplicada ou ausente:** deduplicação por id de sessão e teste de N linhas.
- **Migração de config:** passo próprio em `STEPS`, com teste de idempotência; sem ele a config antiga quebra.
- **Aviso ignorado ou só em um idioma:** teste dos catálogos e verificação visual do aviso antes da confirmação.
- **Dependência da issue de sessões:** itens 7 e critério 9 fora desta entrega; entregar 0 a 6 e 8 sem eles.
- **Repositório público:** exemplos neutros, sem nomes, hosts nem números de issue reais nos testes e fixtures.

## Critérios que o plano não cobre

- 1 e 3 em automação (precisam de conta real; ficam para QA manual).
- 9 e a parte de sessão solta do 8 (dependem da issue de sessões).

## Perguntas

Nenhuma bloqueia o plano. A precedência (decisão 2) segue a proposta da spec; a resposta da sondagem pode reduzir o escopo (sem `mirror`, ou sem a opção).

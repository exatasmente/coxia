# Memória do ciclo

## Decisões

- Triagem da #143: **bug**, confirmada por leitura de código. Entende-se como está escrita; nada falta a quem abriu.
- **Tipo e escopo:** é o mesmo problema da #142 num outro modo de execução, o `shell: host`, que a #142 deixa de fora por decisão própria. Não é duplicata. A #143 depende da #142 mesclada (as duas mexem no mesmo ponto do executor).
- **Refino — D1:** a comprovação de uma etapa de host é lida da **própria pasta de saída que a sessão cria** (a que o prompt apresenta em `COXIA_OUT` e que `ViewImage` já conhece), não de uma pasta de etapa nova.
- **Refino — D2:** "testar uma interface" numa etapa de host continua sendo **exatamente a condição de hoje** (pasta de navegadores disponível ou tela virtual pedida).
- **Plano (esta etapa):** a **raiz da comprovação vira um campo da sessão** (`SandboxSession.outputDir`): a sandbox declara `<pasta de etapa>/out`, a sessão de host com teste de interface declara o `out` da pasta temporária (`shots`/`gui.out`), e a sessão de host sem teste de interface não declara nada. Um ponto só decide: no executor, `const evidenceRoot = session?.outputDir` substitui `session?.stageDir` em `input.evidence`, na montagem das ferramentas de comprovação e em `keepLooked`. As regras de comprovação (caminho, link, tipo pelos bytes, teto, ids) não são reescritas.
- **Plano:** `resolveOutputPath` passa a receber a **raiz da pasta de saída** em vez da pasta de etapa (o corpo muda em uma linha); `EvidenceContext.stageDir` vira `outputDir`, e o `annotate` monta o destino do PNG marcado a partir da raiz.
- **Plano:** as três chaves dos catálogos que citam `/coxia/out` fixo (`prompt.sdd.runner.rules.evidence`, `prompt.sdd.runner.output.evidence` e a descrição da ferramenta de comprovação, esta a conferir) ganham `{out}` e uma variante `.host`, como `runner.rules.gui.host` já faz. `runner.rules.gui.host` já cita `COXIA_OUT`; `ViewImage` já nomeia a pasta do host.
- **Plano:** nenhuma linha nova de conversa e nenhuma migração de configuração (não há campo de config novo). A nota de lançamento vai ao `CHANGELOG.md` sob `## [Unreleased]`, na implementação ou no fecho.

## Restrições

- Tudo o que está dito como existente foi **lido em arquivo nesta cópia**; o que não foi lido está marcado como não verificado. Nada foi executado em nenhuma etapa até aqui.
- A entrega começa depois da #142 mesclada. **Não verificado:** se ela está na ramificação da implementação (não há acesso ao git); o fecho dela está no código desta cópia.
- Toda escrita externa passa por `Actions`; esta mudança não escreve fora do disco, e nada novo é oferecido além do que o host já oferece.
- A conferência pública e as regras do repositório valem para tudo o que este ciclo escrever (sem nome real, host, número de issue ou credencial).

## Tentado e descartado

- Perguntar ao repórter: descartado na triagem; a issue traz o que viu, onde no código e a aceitação item por item.
- Tratar a #143 como duplicata da #142: descartado; a #142 exclui o host de propósito.
- Criar uma pasta de etapa para o host só para a comprovação: descartado no refino (D1) e mantido no plano.
- Ligar a pasta de saída do host sem navegadores nem tela virtual: descartado no refino (D2).
- No plano: duplicar as ferramentas de comprovação para o host (as regras são as mesmas; duas cópias seriam duas coisas a manter iguais) e acrescentar uma linha de conversa própria do host (a publicação comum já diz o que foi guardado).
- No plano: ajustar a semântica do conjunto `lookedPaths` do executor (é do escopo da #142 e não muda nada para o host).

## Perguntas abertas

- Nenhuma bloqueante. **Não verificado:** o comportamento do modo host (nenhum comando, nenhum run, nenhuma tela em nenhuma etapa até aqui); o caminho de uma etapa de host que roda de novo sobre comprovação já guardada; o texto da descrição da ferramenta de comprovação (`src/main/evidence/tool.ts`, não aberto no plano); a corrida da suíte nesta cópia.

## Onde o trabalho está

- A triagem entregou o `0_TRIAGE.md`, o refino o `1_SPEC.md` e o plano o `2_PLAN.md`, na pasta do ciclo. Nada foi mudado no código; nenhum documento da #142 pertence a este ciclo.
- O `2_PLAN.md` traz: a dependência da #142, 10 mudanças por arquivo e função na ordem, o ponto único do executor, 10 testes por comportamento com o arquivo de teste de cada um, os riscos com a contenção, 7 decisões com motivo, o mapa dos 8 critérios de aceite e o que não foi verificado.
- **Passagem plano → implementação:** seguir o `2_PLAN.md` na ordem dos passos; confirmar a #142 na base antes de tocar o executor; conferir se a descrição da ferramenta de comprovação cita `/coxia/out` fixo; escrever os 10 testes e a linha do `CHANGELOG.md` sob `## [Unreleased]`; rodar `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` e `node scripts/public-audit.mjs` e relatar o que de fato rodou.
- Passagem support → product-owner: Refinar a #143 em `1_SPEC.md`: fixar as duas decisões em aberto (a pasta de saída do host como raiz da leitura da comprovação — reaproveitar a pasta de etapa ou ligar as ferramentas à pasta criada pelo host — e o que conta como "testar uma interface" numa etapa de host; hoje a pasta só nasce com navegadores ou tela virtual ligados, e ligá-la sem eles muda o prompt de uma etapa que hoje não a tem). O material desta etapa é leitura de código, não execução: o comportamento do modo host não foi exercitado. A entrega depende da #142 já mesclada (ambas mexem no mesmo arquivo do executor); se a #142 … <!-- handoff:6 -->
- Passagem product-owner → pessoa: Planejar a #143 a partir do `1_SPEC.md`: (1) confirmar que a #142 já está mesclada na base antes de tocar `src/main/runner/executor.ts` — as duas mexem no mesmo ponto; se não estiver, o plano precisa dizer isso. (2) Levar para o plano, sem reabrir a decisão: D1 (a pasta de saída da própria sessão de host é a raiz da leitura da comprovação, sem pasta de etapa nova) e D2 (testar uma interface no host = pasta de navegadores disponível ou tela virtual pedida, a condição de hoje). (3) Onde a pasta de saída do host precisa estar disponível: em `openHostSession`/`openSandboxService.openHost` (`gui.ou… <!-- handoff:13 -->

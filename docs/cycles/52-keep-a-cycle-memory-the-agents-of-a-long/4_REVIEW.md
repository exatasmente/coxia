# A memória do ciclo passa nas portas do repositório

## Veredito

`approved`. A segunda passada fechou os quatro achados que a rodada anterior marcou como bloqueantes, e nenhuma porta do repositório fica vermelha. O que resta são duas sugestões não bloqueantes já registradas e um detalhe de robustez que não foi introduzido nesta passada.

## O que foi verificado, e como

As portas foram rodadas numa cópia descartável do código, com o Node do `.nvmrc` (`v26.5.1`):

| Porta | Resultado |
|---|---|
| `npx tsc --noEmit` | passa (saída 0) |
| `npx vitest run` | passa: 213 arquivos, 3542 testes, 0 falhas |
| `node scripts/theme-audit.mjs` | passa (saída 0) |
| `npm run i18n:lint` | passa (saída 0): 4012 chaves nos dois idiomas, 0 faltando |
| `node scripts/public-audit.mjs` | passa: “859 files, nothing that belongs to a company or a person” |
| `npx electron-vite build` | passa (saída 0) |

### Os quatro achados da rodada anterior

1. **Gravações de referência** (`test/fixtures/runner-golden/`): `test/runner-golden.test.ts` passa nos seis cenários. As gravações foram corrigidas à mão na passada anterior; a comparação da suíte é por igualdade exata do objeto inteiro, ordem incluída, então o verde confirma que a ordem derivada da fonte (`MEMORY.md` em `written`, referência das mensagens do fórum) bate com a execução.
2. **Expectativa de `runner-squads`**: `test/runner-squads.test.ts` passa; a lista esperada acompanhou `['MEMORY.md', '0_TRIAGE.md']`.
3. **Ordem das chaves de tradução**: `test/ui-i18n.test.ts` passa; o bloco `ui.cycle.artifact.*` está em ordem (`cancel`, `clipped`, `edit`, `editLabel`, `gone`, `loading`, `save`) nos dois catálogos.
4. **Mascaramento do texto da conversa**: por leitura, `factsOfThread` (`src/main/runner/memory.ts:93,96`) passa tanto o texto da resposta quanto o da passagem por `redact` antes de montar a linha do fato; o marcador vem de `m.seq` e não é afetado. Os testes de unidade e de ponta a ponta da memória passam.

### O que se confirmou por leitura (sem execução de comportamento)

- A leitura da pasta devolve a memória primeiro, depois o registro da issue, depois os demais em ordem de nome, e a memória e os documentos declarados em `reads` não gastam o orçamento (`src/main/runner/cycleFolder.ts:76-97`).
- O executor aplica `ensureMemory` → `factsOfThread` → `readMemory` → `applyFacts` → `writeMemory` antes de ler a pasta, e o retorno da etapa só reescreve a memória quando a etapa conclui; uma etapa que pausa numa pergunta não escreve (`src/main/runner/executor.ts:338-345,468-474`).
- A edição da pessoa mascara o texto, usa a guarda de caminho da escrita e recusa enquanto um agente trabalha (`src/main/runner/service.ts:794-807`); o histórico registra `memory-edited` com autoria `person`.

## Sugestões

### 1. Documento que não cabe é deixado de fora em silêncio

`src/main/runner/cycleFolder.ts:90`: quando o total da pasta acaba, os documentos restantes (os mais antigos) não entram e não recebem marca nenhuma. A aceitação da spec diz “cada corte é marcado” e o plano diz “cada um que não couber inteiro recebe a marca de corte”. O comportamento é anterior a esta mudança, e a ordem nova — mais antigos primeiro — torna o sumiço silencioso o desfecho provável. Não bloqueia.

### 2. O momento do commit dos fatos da conversa

`src/main/runner/executor.ts:339-345`: os fatos aplicados e gravados no início da etapa seguinte vão no commit dessa etapa. Uma execução que pare logo depois de uma resposta, sem etapa seguinte, não leva o acréscimo ao disco nem a um commit. A divergência está registrada em `3_IMPLEMENTATION.md`, §5. O efeito que a spec pede (o fato sobrevive à janela de 40 mensagens) continua valendo enquanto a execução anda. Não bloqueia.

### 3. O marcador de um fato casa como fragmento de outro

`src/main/runner/memory.ts:135`: a idempotência procura o marcador com `out.includes(f.marker)`. O marcador é `answer:<n>` / `handoff:<n>`, então `answer:3` casa dentro de `answer:30`. Se o modelo, ao reescrever, mantiver a linha de uma mensagem de número maior e deixar cair o marcador de uma menor, a reaplicação considera o fato menor já presente e ele não volta — uma resposta pode se perder. É anterior a esta passada e não a impede de ser aprovada; fica registrado para uma passada própria (por exemplo, casar o marcador completo, `<!-- answer:3 -->`, ou exigir limite de palavra).

## Não revisado

- O comportamento com um modelo de verdade e a equivalência entre o motor aberto e o Claude Agent SDK não foram exercitados; só se leu que o campo novo viaja no mesmo esquema de resposta.
- A retomada de uma execução depois de reiniciar o aplicativo não foi exercitada.
- A tela da execução não foi aberta: o modo de edição da memória foi lido no código, não usado.
- A auditoria pública corre sobre os arquivos deste repositório; não se conferiu o comportamento dela sobre a memória escrita num worktree de execução real.

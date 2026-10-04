# Revisão: o registro de ciclo das execuções longas

## Veredito

`changes`. O recurso está implementado e o que foi exercitado funciona: a memória nasce com a execução, é lida inteira antes dos outros documentos, é reescrita pela etapa que conclui, é normalizada e pode ser corrigida pela pessoa. Mas a suíte de testes do projeto não passa — 8 verificações falham em 3 arquivos — e um ponto da fronteira de segurança ficou aberto: o texto que a pessoa escreve na conversa chega à memória sem o mascaramento de credencial que os outros dois caminhos de escrita aplicam.

## O que foi verificado, e como

Portas rodadas nesta etapa (cópia descartável do worktree, Node do `.nvmrc`):

| Porta | Resultado |
|---|---|
| `npx tsc --noEmit` | passa (saída 0) |
| `npx vitest run` | **falha**: 3 arquivos, 8 testes de 3542 |
| `node scripts/theme-audit.mjs` | passa (saída 0) |
| `npm run i18n:lint` | passa (saída 0) |
| `node scripts/public-audit.mjs` | passa: "858 files, nothing that belongs to a company or a person" |
| `electron-vite build` | não rodada |

Falhas do `vitest`: `test/runner-golden.test.ts` 6, `test/runner-squads.test.ts` 1, `test/ui-i18n.test.ts` 1.

Por leitura do código (não por execução):

- A ordem no executor segue o desenho: `ensureMemory` → `factsOfThread` → `readMemory` → `applyFacts` → `writeMemory` (`executor.ts:339-345`), e só depois `readFolder`, de modo que a etapa recebe o arquivo já com os fatos; a escrita do retorno da etapa vem depois (`executor.ts:472-473`).
- A idempotência dos marcadores existe e é testada (`test/runner-memory.test.ts`, 9 testes que passam): `applyFacts` pula o fato cujo marcador já está no texto, devolve o marcador a uma linha que o modelo manteve sem ele (`lineWith`) e só então insere um item.
- O orçamento da pasta não corta a memória nem o registro da issue (`cycleFolder.ts:81-96`): os arquivos "inteiros" não gastam orçamento; entre os demais, os mais antigos são lidos por último.
- A retirada do filtro por `stage.reads` do executor corresponde ao plano (item 1 e item 10: "o filtro por `stage.reads` sai do executor e entra nessa leitura"); não é achado.
- Os testes novos de ponta a ponta que exercitam a memória passam (`test/runner-e2e.test.ts`, 5 testes).

## Achados que bloqueiam

### 1. As gravações de referência não foram regeradas — a suíte fica vermelha

Arquivo: `test/fixtures/runner-golden/` (as seis gravações). `test/runner-golden.test.ts` falha em 6 testes; cada falha é uma gravação com `"MEMORY.md"` a mais na lista de artefatos da etapa e nas mensagens do fórum. A mudança que quebra a gravação é a pretendida — o plano, item 5, manda incluir `MEMORY.md` em `written` "para o commit da etapa levá-lo e para a tela e a conversa o listarem" — mas as gravações continuam com o conteúdo antigo. `CLAUDE.md`: "A red gate is not 'done'."

Correção: confirmada a mudança como querida, regerar com `UPDATE_GOLDEN=1 npx vitest run test/runner-golden.test.ts` e commitar as seis gravações. `UPDATE_GOLDEN` só para uma mudança de comportamento querida, nunca para fazer um teste vermelho ficar verde.

### 2. A expectativa de `runner-squads` não foi atualizada

`test/runner-squads.test.ts:107` espera `result: { summary: 'Triaged.', artifacts: ['0_TRIAGE.md'] }`; a execução real devolve `['MEMORY.md', '0_TRIAGE.md']`. Mesma causa da anterior, mesmo caráter pretendido; a expectativa exata é que ficou para trás.

Correção: atualizar a lista esperada para incluir `MEMORY.md`.

### 3. As chaves novas de tradução ficaram fora de ordem

`src/shared/i18n/ui-cycle.en.json:34-37` e o gêmeo `ui-cycle.pt-BR.json` inserem `ui.cycle.artifact.edit`, `.editLabel` e `.cancel` no meio da lista, quebrando a ordem alfabética que `test/ui-i18n.test.ts:59` exige (`keys` deve ser igual a `[...keys].sort()`). Os dois catálogos falham nesse teste. `npm run i18n:lint` passa, então não é ele que pega.

Correção: reordenar as chaves nos dois catálogos (`cancel`, `clipped`, `edit`, `editLabel`, `gone`, `loading`, `save`).

### 4. A resposta da pessoa entra na memória sem mascaramento de credencial

`src/main/runner/memory.ts:91` monta o fato da resposta a partir de `m.text` cru. O texto de uma mensagem da pessoa não é mascarado quando é guardado — `src/main/forum-core.ts:238-240` só mascara autor que não é pessoa (`untrusted = a.type !== 'person'`) — e o executor grava o resultado de `applyFacts` sem `redact` (`src/main/runner/executor.ts:345`). Os outros dois caminhos de escrita da memória mascaram: a edição da pessoa (`src/main/runner/service.ts:803`) e o retorno da etapa (`src/main/runner/executor.ts:473`). A spec, regra 10, pede "as mesmas regras dos outros documentos" e "o que parece credencial é mascarado"; a aceitação diz que o arquivo "não traz credencial". O arquivo é versionado e vai no pull request: uma resposta que cole um token fica gravada no ramo.

Correção: passar o texto do fato por `redact` ao montá-lo (o marcador `<!-- answer:n -->` não é afetado), ou mascarar o texto antes de gravar no executor.

## Sugestões

### 5. O momento do commit dos fatos da conversa

O plano, item 7, diz que o acréscimo feito entre etapas "é gravado e commitado pela aplicação, com a identidade do workspace". Na implementação, os fatos são aplicados e gravados no início da etapa seguinte (`src/main/runner/executor.ts:339-345`) e vão no commit dessa etapa. Se a execução parar, for cancelada, ou não houver etapa seguinte, a resposta ou a passagem nunca chega ao disco nem a um commit. A divergência já está registrada em `3_IMPLEMENTATION.md`, §5; a aceitação da spec (o fato sobrevive à janela de 40 mensagens) continua valendo enquanto a execução anda. Vale decidir: commitar no momento da resposta (`service.ts`, como o §5 descreve) ou aceitar o risco por escrito nos documentos — e, em qualquer caso, um teste para o caso "resposta → execução sem etapa seguinte".

### 6. Documento que não cabe é deixado de fora em silêncio

`src/main/runner/cycleFolder.ts:90`: quando o total da pasta acaba, os documentos restantes (os mais antigos) não entram e não recebem marca nenhuma. A aceitação da spec diz "cada corte é marcado" e o plano diz "cada um que não couber inteiro recebe a marca de corte". O comportamento é anterior a esta mudança (a versão anterior faz o mesmo), mas a ordem nova — mais antigos primeiro — torna o sumiço silencioso o desfecho provável, e o teste novo de orçamento codifica isso (`1_A.md` ausente). Cabe ou um item de aviso para o documento deixado de fora, ou uma frase nos documentos dizendo que o que não couber de todo fica de fora sem aviso.

## Não revisado

- `electron-vite build` (porta do CI) não foi rodada.
- A equivalência entre o motor aberto e o Claude Agent SDK não foi exercitada; só se leu que o campo novo viaja no mesmo esquema de resposta.
- A retomada de uma execução depois de reiniciar o aplicativo não foi exercitada.
- A tela da execução não foi aberta: a edição da memória pela pessoa foi lida no código, não usada.
- A auditoria pública corre sobre os arquivos deste repositório; não se conferiu o comportamento dela sobre a memória escrita num worktree de execução real.

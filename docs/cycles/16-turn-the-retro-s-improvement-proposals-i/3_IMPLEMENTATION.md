# Ajustes da revisão e do QA na entrega das melhorias

Os três passos do plano já estavam no worktree. Nesta passada foram tratados os quatro
apontamentos da revisão, os buracos que o QA marcou, e dois defeitos que só apareceram quando
os gates finalmente rodaram. Nada foi commitado.

## 1. O que mudou nesta passada

### Apontamentos da revisão

1. **Colisão de chave** (`src/main/retroIssues.ts:82-85`). Duas melhorias cujo título, depois
de virar resumo e ser cortado em 40 caracteres, dava o mesmo valor geravam a mesma chave; a
segunda não virava proposta nem ganhava nota. Agora um conjunto de chaves já usadas na mesma
leva desempata com o índice: a segunda melhoria recebe `…:<índice>` e vira proposta. O
comportamento normal (títulos distintos) continua com a mesma chave de antes, então a
deduplicação entre rodadas segue igual.
2. **Override morto no perfil de exemplo** (`docs/examples/legacy-profile.example.json`). O
bloco `promptOverrides.retro.improvementsFormat`, que depois da mudança não casa com chave
de prompt nenhuma, foi removido.
3. **Campo supérfluo no dublê** (`test/squad-ceremonies.test.ts:28`). `melhorias: []` saiu da
resposta falsa de `askAgent`.
4. **Comentário defasado** (`src/renderer/src/screens/RetroScreen.tsx:91`). A primeira metade
da frase, que falava da convenção IMPROVEMENTS.md, saiu; restou "The gate quizzes belong to
the SDD cycle; any other cycle gets the neutral wording."

### Buracos do QA

5. **Caminho "a integração existe, mas não escreve issue"** ganhou caso próprio em
`test/retro-issues.test.ts`: um provedor com `caps.issues` falso, que leva a fala do motivo
(`main.retro.issue.noWrite`) e nenhuma proposta.
6. **Colisão de títulos** ganhou caso de teste: duas melhorias de 48 caracteres que só divergem
depois do 40º resumo geram duas propostas com chaves distintas e duas notas na conversa.

### Defeitos encontrados ao rodar os gates

7. **Texto morto nos catálogos reprovava a suíte.** O plano supunha que o lint não acusa chave
sem uso, mas `test/ui-i18n.test.ts:81` (`leave no ui.* key unused`) reprova: sete chaves
`ui.retro.*` ficaram sem chamador depois que a seção de melhorias saiu da tela
(`ui.retro.copied`, `ui.retro.copyEntry`, `ui.retro.entry.dimension`,
`ui.retro.entry.problem`, `ui.retro.entry.proposal`, `ui.retro.problem`, `ui.retro.proposal`).
Elas saíram de `src/shared/i18n/ui-docs.{en,pt-BR}.json` e entraram em `REMOVED`
(`test/gitlab-catalogs-unchanged.test.ts`), cada uma com motivo.
8. **Contagem errada no caso 7 do teste novo.** O caso "não agora" esperava quatro falas na
conversa; são três (a pergunta, a resposta do moderador e a nota da proposta). A expectativa
foi corrigida para três, com um comentário dizendo quais são.

## 2. Arquivos tocados nesta passada

Modificados: `src/main/retroIssues.ts`, `src/renderer/src/screens/RetroScreen.tsx`,
`src/shared/i18n/ui-docs.en.json`, `src/shared/i18n/ui-docs.pt-BR.json`,
`test/gitlab-catalogs-unchanged.test.ts`, `test/retro-issues.test.ts`,
`test/squad-ceremonies.test.ts`, `docs/examples/legacy-profile.example.json`.

Sem arquivo novo nesta passada. O restante da mudança (o código e os textos do plano original)
segue como estava no worktree.

## 3. O que foi verificado nesta passada

Os dois comandos permitidos rodaram de verdade, porque nesta árvore há `node_modules`:

- `npm run typecheck` → código 0, sem erros (`tsc --noEmit -p tsconfig.json`).
- `npm test` → **175 arquivos, 2975 testes, todos passando**. Duas linhas de lint aparecem na
saída e são esperadas: vêm de dois testes que pedem a reprovação do lint de propósito
(`exits non-zero above the allowed total` e `refuses a scope it does not know`); os testes
que exigem o lint limpo passaram.

Consequências do que a suíte exercitou:

- Os quatro textos de ouro dos prompts, que tinham sido editados à mão, **passaram no teste de
paridade** (`test/cycle-parity-en*.test.ts`). Isso prova que a edição à mão corresponde ao
que a regeneração produziria — o plano pedia `UPDATE_GOLDEN=1`, que não está entre os
comandos desta etapa, mas a paridade por execução cobre a mesma dúvida.
- A guarda dos catálogos congelados passou com as quatro entradas de `INTENDED` e as onze de
`REMOVED` (as quatro do plano mais as sete desta passada).
- Os casos de `test/retro-issues.test.ts` — inclusive a criação da issue com início automático
da execução, a recusa em espaço de trabalho de testes, os quatro motivos de não dar, a
deduplicação e as duas adições desta passada — passaram.
- Os testes que rodam o lint de traduções (`test/ui-i18n.test.ts`, `test/i18n.test.ts`) e a
regra de chave sem uso passaram.

Verificado por leitura, contra o resultado dos testes: o desempate de chave só entra na
colisão, então a chave da proposta normal não muda.

## 4. O que não foi verificado

- `node scripts/theme-audit.mjs`, `npm run i18n:lint` e `node scripts/public-audit.mjs` como
comandos e `electron-vite build`: **não rodados** — esta etapa só pode chamar `npm test` e
`npm run typecheck`. O lint de traduções foi exercitado dentro da suíte (que passou), e
`test/public-audit.test.ts` testa as regras da auditoria com entrada sintética, não a árvore
real; a auditoria de verdade sobre os arquivos desta mudança segue **não verificada**.
- Se o modelo preenche `melhorias` sem o prompt pedir: depende de modelo real, não observado.
- Se a tela renderiza o cartão da proposta como descrito: não há teste de tela renderizada para
a retro; a prova é leitura da fonte e o teste de fonte da tela.
- Se a execução começa de fato logo depois de a issue existir num rastreador real: o teste
prova a fiação com host falso, não o host. O caso também não confere pasta de ciclo, conversa
nem documentos da execução; isso vem do caminho comum de início de tarefa e é coberto pelos
testes do runner, não por este.

## 5. Divergências do plano

1. **A decisão 5 do plano estava errada.** Ela mandava deixar as chaves de tela sem uso para
não somar exceções à guarda, afirmando que o lint não as acusa. `test/ui-i18n.test.ts:81`
acusa, e a suíte ficava vermelha. As sete chaves foram removidas e listadas em `REMOVED`,
como descrito em 1.7.
2. **Os textos de ouro não foram regenerados com `UPDATE_GOLDEN=1`** (comando indisponível
nesta etapa); a edição à mão passou no teste de paridade por execução.
3. **O caso 7 do teste novo foi corrigido** (esperava quatro falas, são três), como descrito
em 1.8 — era defeito do teste, não do código.
4. A execução segue sem os três commits do plano: esta etapa não commita.

## 6. Gates

`npm run typecheck` e `npm test` verdes. Os demais gates do repositório e o build não rodaram
(§4).

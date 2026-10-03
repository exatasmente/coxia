# Triagem: propostas de melhoria da retro fora da cerimônia

## Tipo

Pedido de funcionalidade. Não relata defeito, não é pergunta e não repete outra issue: pede que as propostas de melhoria do processo que a retro levanta deixem de viver só dentro da retro e passem a ser uma tarefa do fluxo de agentes, com saída própria.

## Dá para entender como está escrita

Dá. O comportamento descrito confere com o código citado:

- As propostas (`melhorias`) nascem junto com o resumo da retro e são gravadas apenas dentro do registro da retro: `src/main/retro.ts:135,154,170`, com o campo `improvements` em `src/shared/types.ts:363-379`. Não há gravação em outro lugar nem criação de tarefa a partir delas.
- Na tela, cada proposta é exibida e pode ser copiada como uma seção em markdown (`src/renderer/src/screens/RetroScreen.tsx:17-28,178-188`); a saída para o time é manual, pela área de transferência.
- A retro não altera nada fora do aplicativo. A guarda de escrita externa (`assertExternalWrite`, `src/main/workspace.ts:18`) e a aprovação por ação existem no gate, no QA e no release, não na retro — a nota da issue sobre mover a guarda é condicional, para quando a escrita existir, e hoje não existe.
- A família de texto da retro carrega um formato próprio para as melhorias (`prompt.sdd.retro.improvementsFormat`, `src/shared/i18n/en.json:446`), usado no prompt em `src/main/retro.ts:145`; os textos de ouro dos prompts guardam a palavra `melhorias` (`test/golden/en-prompts.json`, `test/golden/legacy-prompts.json`). Tirar as melhorias do prompt da retro muda esses textos de ouro.

Ressalva de citação: o trecho indicado para `src/main/retro.ts` (linhas 257-307) não existe; o arquivo tem 189 linhas hoje. O comportamento citado está nas linhas atuais acima. A citação da tela (`RetroScreen.tsx:15-24`) corresponde à função que monta a entrada copiada.

Verificação: leitura da issue, do código e dos documentos do ciclo. Nada foi executado e o comportamento não foi reproduzido no aplicativo.

## O que falta

Nada que a triagem precise ouvir de quem abriu para seguir.

## Issues relacionadas

- Issue-mãe sobre os três trabalhos das cerimônias (#8): origem desta; o item que nomeia "as propostas de melhoria viram uma tarefa de agente" já está aprovado nela. Não é duplicata.
- Issue da auditoria das cerimônias (#12): fornece a evidência que esta issue cita (as melhorias ficam fora dos três trabalhos e sem persistência própria). Não é duplicata.
- Issue do ciclo de agentes e do runner (#9): define o que é uma tarefa de agente no aplicativo — uma execução por issue, com pasta de ciclo e artefatos próprios. É a peça que dá forma à saída pedida aqui. Não é duplicata.
- Nenhuma issue parece duplicar esta.

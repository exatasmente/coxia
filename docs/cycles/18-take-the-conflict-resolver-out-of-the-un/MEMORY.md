# Memória do ciclo

## Decisões

- A issue 18 é um pedido de funcionalidade (enhancement), não um bug: pede a retirada do painel de conflito da tela de desbloqueio e que o bloqueio aponte para o botão que já existe na tela de Hoje.
- Escopo fixado no comentário de quem abriu: só a retirada do painel, o apontamento do bloqueio e a limpeza do que ficar órfão (os textos do painel e a marca de lugar da tela de desbloqueio). Sem migração de configuração.
- A especificação funcional está em 1_SPEC.md, nas palavras do produto, com sete critérios de aceite. Nada falta na issue; não há pergunta para quem abriu.
- Prioridade: manter low. Marco: nenhum.
- Plano técnico fechado em 2_PLAN.md: saem a seção do painel, os dois imports que ficam sem uso, o valor `'deep'` de `ConflictPlace` e as duas chaves de texto nos dois catálogos e nas cópias dos testes (quatro arquivos ao todo). Nada mais muda; nenhum teste novo é necessário.

## Restrições

- A detecção de conflito (`conflictMrs`) e a forma de resolver conflito não mudam; os dois pontos do botão na tela de Hoje (linha do que precisa de atenção, `TodayParts.tsx:114`; linha de atividade, `:224`) não são tocados.
- A linha do bloqueio (`dashboard.ts:208-221`) já carrega `conflictCard` e, quando o conflito é o próprio bloqueio, `conflictRef`; o apontamento já existe e não muda.
- A guarda de escrita externa vive no processo principal (`approveAction` chama `assertExternalWrite`; o push da resolução é um `conflict-push` que passa por `actions:approve`); o botão de conflito só cria a ação e abre a tela do conflito. Nada preso ao painel sai com ele.
- Os textos saem ou não saem por inteiro: os dois catálogos (`ui-call.*.json`) e as duas cópias em `test/fixtures/catalogs-main/` andam juntos, senão os portões de i18n e de catálogo quebram.
- A tela de desbloqueio continua sendo destino válido de outros caminhos (linha do bloqueio e pergunta aberta); não é para removê-la, só o painel.

## Tentado e descartado

- Perguntar a quem abriu: descartado; a issue e o comentário respondem o que faltaria.
- Decidir prioridade ou propor solução no refinamento: fora do escopo daquela etapa.
- Mudar a linha de bloqueio para apontar para outro lugar: descartado; o apontamento já funciona como pedido e mexer nele seria mudança fora do escopo.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Refinamento e plano feitos: 1_SPEC.md e 2_PLAN.md escritos nesta pasta. Nada foi executado nem alterado no repositório além dos documentos: a remoção do painel ainda não existe no código.
- Nenhum portão rodado até agora (só leitura de código, catálogos e testes). O `node scripts/public-audit.mjs` ainda não detectou o padrão literal `deep` em `ResolveConflict.tsx:30` como violação (`deep` está na lista de termos que ele procura e também é o papel de modelo em `ui.settings.role.deep.*`); a implementação deve rodar os portões e confirmar.
- A implementação deve: apagar a seção do painel em `Deep.tsx:245-251` e os imports das linhas 15 e 16; tirar `'deep'` de `ConflictPlace` (`ResolveConflict.tsx:10`); remover `ui.deep.conflict` e `ui.deep.conflictNote` de `src/shared/i18n/ui-call.en.json` e `ui-call.pt-BR.json` e das cópias em `test/fixtures/catalogs-main/` (linhas 105-106 nos quatro); rodar `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` e `node scripts/public-audit.mjs`.
- Ao alcance da implementação: o roteiro de teste de um ciclo anterior (`docs/cycles/20-resolve-conflict-button/3_TEST_PLAN.md`, checagem 2) descreve a tela de desbloqueio mostrando o painel e precisa de ajuste; nenhum teste automatizado afirma isso.
- Nada verificado em execução: a retirada em si só estará confirmada quando a implementação rodar os portões.
- Passagem support → product-owner: Retirar o painel de conflito da tela de desbloqueio: apagar o bloco da seção que hospeda o botão, remover a marca de lugar 'deep' do componente do botão e os textos ui.deep.conflict / ui.deep.conflictNote dos dois catálogos e das cópias nos fixtures de teste. Deixar a linha do bloqueio apontando para o botão que já existe na tela de Hoje. Confirmar que nenhum controle de escrita externa fica órfão com a remoção e que nenhum teste afirma que a tela de desbloqueio mostra o painel. Não alterar a detecção de conflito nem os pontos onde o botão já aparece em Hoje. <!-- handoff:6 -->
- Passagem product-owner → pessoa: Planejar e implementar a retirada. 1) Apagar a seção inteira do painel de conflito no terceiro painel da tela de desbloqueio (Deep.tsx:245-251), junto com o import do botão (Deep.tsx:15) e o de conflictMrs (Deep.tsx:16) se ficarem sem uso. 2) Tirar 'deep' de ConflictPlace (ResolveConflict.tsx:10); conferir que place="need" e place="act" seguem intactos e que a chave de jobs (prefixo conflictmr:place:ref:) não quebra. 3) Remover as chaves ui.deep.conflict e ui.deep.conflictNote de src/shared/i18n/ui-call.en.json e ui-call.pt-BR.json (linhas 105-106) e das cópias espelhadas em test/fixtures/cata… <!-- handoff:11 -->

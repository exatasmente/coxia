# Memória do ciclo

## Decisões

- A issue 18 é um pedido de funcionalidade (enhancement), não um bug: pede a retirada do painel de conflito da tela de desbloqueio e que o bloqueio passe a apontar para o botão que já existe na tela de Hoje.
- Escopo fixado pelo comentário de quem abriu: só a retirada do painel, o apontamento do bloqueio e a limpeza do que ficar órfão (os textos do painel e a marca de lugar da tela de desbloqueio). Sem migração de configuração.
- A especificação funcional está escrita em 1_SPEC.md, nas palavras do produto: o que muda para quem usa, regras, fora do escopo e sete critérios de aceite. Nada falta na issue; não há pergunta para quem abriu.
- Sugestão de prioridade: manter low, por ser retirada pequena e sem mudança de comportamento para quem usa o app além de onde o botão aparece. Marco: nenhum.

## Restrições

- A detecção de qual requisição está em conflito não muda; a forma de resolver o conflito também não.
- O botão de resolver conflito já existe na tela de Hoje, em dois pontos (a linha do que precisa de atenção e a linha de atividade do card); nenhum deles muda.
- O apontamento do bloqueio deve mirar o botão existente, não criar um novo.
- Os textos que saírem vivem nos dois catálogos de idioma e têm cópias espelhadas nos fixtures usados pelos testes; as duas pontas precisam sair juntas ou os portões de idioma/catálogo quebram.
- Nenhum controle de escrita externa está preso ao painel: a guarda de escrita externa vive no processo principal e o botão só prepara a resolução e abre a tela do conflito.

## Tentado e descartado

- Perguntar a quem abriu: descartado, a issue e o comentário respondem o que faltaria.
- Propor solução ou decidir prioridade: fora do escopo desta etapa; só há uma sugestão registrada no documento.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Refinamento feito: 1_SPEC.md escrito nesta pasta (a issue como recebida, a triagem e a memória já estavam).
- Nada foi executado nem alterado no repositório além desse documento; a remoção do painel ainda não existe no código.
- Leitura que a próxima etapa pode usar: o painel vive na terceira seção da tela de desbloqueio (Deep.tsx:245-251), com os textos ui.deep.conflict / ui.deep.conflictNote e o botão com place="deep"; o mesmo botão já aparece na tela de Hoje (TodayParts.tsx:114 e :224); a marca de lugar tem três valores (ResolveConflict.tsx:10) e 'deep' só é usado por esse painel; a linha de bloqueio já monta o card com conflito e a referência exata para o botão (dashboard.ts:208-221).
- Passagem support → product-owner: Retirar o painel de conflito da tela de desbloqueio: apagar o bloco da seção que hospeda o botão, remover a marca de lugar 'deep' do componente do botão e os textos ui.deep.conflict / ui.deep.conflictNote dos dois catálogos e das cópias nos fixtures de teste. Deixar a linha do bloqueio apontando para o botão que já existe na tela de Hoje. Confirmar que nenhum controle de escrita externa fica órfão com a remoção e que nenhum teste afirma que a tela de desbloqueio mostra o painel. Não alterar a detecção de conflito nem os pontos onde o botão já aparece em Hoje. <!-- handoff:6 -->
- Passagem product-owner → próxima etapa: planejar e implementar conforme 1_SPEC.md e o detalhamento técnico do comentário; um roteiro de teste do ciclo 17 descreve a tela de desbloqueio mostrando o painel e precisa de ajuste quando o arquivo estiver ao alcance.

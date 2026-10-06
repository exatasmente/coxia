# Memória do ciclo

## Decisões

- A issue 18 é um pedido de funcionalidade (enhancement), não um bug: pede a retirada do painel de conflito da tela de desbloqueio e que o bloqueio passe a apontar para o botão que já existe na tela de Hoje.
- Escopo fixado pelo comentário de quem abriu: só a retirada do painel, o apontamento do bloqueio, e a limpeza do que ficar órfão (os textos do painel e a marca de lugar da tela de desbloqueio). Sem migração de configuração.
- Nada falta na issue: a evidência (arquivo e linhas) e o escopo fechado no comentário bastam; não há pergunta para quem abriu.
- Sugestão de prioridade: manter low, por ser retirada pequena e sem mudança de comportamento para quem usa o app além de onde o botão aparece.

## Restrições

- A detecção de qual requisição está em conflito não muda; a forma de resolver o conflito também não.
- O botão de resolver conflito já existe na tela de Hoje, em dois pontos (a linha do que precisa de atenção e a linha de atividade do card); nenhum deles muda.
- O apontamento do bloqueio deve mirar o botão existente, não criar um novo.
- Os textos que saírem vivem nos dois catálogos de idioma e têm cópias espelhadas nos fixtures usados pelos testes; as duas pontas precisam sair juntas ou os portões de idioma/catálogo quebram.
- Verificar se algum controle de escrita externa está preso ao painel e sai com ele.

## Tentado e descartado

- Perguntar a quem abriu: descartado, a issue e o comentário respondem o que faltaria.
- Propor solução ou decidir prioridade: fora do escopo desta etapa; só há uma sugestão registrada no documento.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Triagem feita e registrada; a próxima etapa (refinamento) recebe esta nota e a issue.
- Documentos produzidos nesta pasta: a issue como recebida e a triagem.
- Nada foi executado nem alterado no repositório; a remoção do painel ainda não existe no código.

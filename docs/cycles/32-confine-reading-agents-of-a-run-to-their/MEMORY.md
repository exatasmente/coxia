# Memória do ciclo

## Decisões

- Issue #32 classificada como **bug** (squad Plataforma): no motor do Claude Agent SDK, um agente que só lê numa execução não tem a guarda de caminho que o agente que escreve tem; os testes pedidos no escopo, que ainda não existem nesta mudança, deverão cobrir um link para fora, `..`, `~`, `.git` e um caminho absoluto.
- Nenhuma duplicata encontrada. A issue nasce da decisão **D6** aprovada no ciclo 30 (fechar a lacuna do leitor sem confinamento como mudança separada); #52 é vizinha (mexe no mesmo executor e na pasta do ciclo), não duplicata.
- Prioridade sugerida: `priority:high`, como a issue está rotulada.

## Restrições

- Bug de confinamento: não amplia nada, só restringe. **Não afrouxar** o filtro de arquivo de segredo, a redação de resultados de busca nem a recusa de busca ampla.
- O campo pedido é próprio (por exemplo `readRoot`), **não** `confine`: `confine` também abre `Edit`/`Write` e o shell.
- As cerimônias (daily, unblock, retro) leem a pasta de projetos de propósito e ficam fora.
- Toda recusa vai para a conversa da execução e para a atividade ao vivo como bloqueada, como as outras recusas.
- Fontes de verdade: `src/main/engine/guard.ts` (`checkPath`, com `read: true` já julga leitura e libera a raiz), `src/main/runner/hooks.ts` (monta o guarda de leitura em `Read`/`Grep`/`Glob` e relata cada recusa), `src/main/runner/executor.ts:430` (hoje `confine` só para quem escreve), `src/main/agents.ts` (`allowedFor`, `sdkOptions`, `extraDirs`, `agentHooks`) e `src/main/engine/open/loop.ts:264` (raízes do motor aberto).
- O trabalho de código ainda não existe: esta etapa só leu.

## Tentado e descartado

- Nada foi tentado em código (etapa só de leitura). Na leitura, dois pontos foram separados do escopo como decisão de produto, em vez de virarem pergunta a quem abriu a issue: a lista de pastas de documentação fora da pasta de trabalho e o alcance das menções e da cadeia de perguntas.

## Perguntas abertas

- **Escolha de produto (não é pergunta a quem abriu):** as pastas de documentação listadas fora da pasta de trabalho ficam de fora ou entram numa lista explícita? A mesma configuração que hoje é entregue ao motor como diretórios adicionais do leitor (`agents.ts:1055`) tem de acompanhar essa decisão, senão o fechamento deixa o leitor sem acesso a elas.
- **Escolha de produto:** o alcance das menções e da cadeia de perguntas. Uma menção ou uma pergunta fora da conversa de uma execução não tem pasta de trabalho para servir de raiz; e o contato de um squad chamado por um pedido lê o repositório do próprio squad.
- Sugestão da triagem para as duas: raiz = pasta de trabalho quando ela existe; lista explícita, curta e derivada da configuração, sem `~` nem `..`, com a validação que o sandbox já faz das pastas extras.

## Onde o trabalho está

Triagem concluída. A issue foi lida e a causa conferida no código (leitura apenas, nada exercitado com agente ou modelo real). Falta pintar o que existe e o que se quer na etapa de refinamento, com as duas escolhas acima. O commit desta etapa (`docs: triage issue 32`) leva `0_TRIAGE.md` e esta memória.

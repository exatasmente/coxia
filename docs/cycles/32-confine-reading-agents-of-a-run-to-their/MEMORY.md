# Memória do ciclo

## Decisões

- Issue #32 é **bug** (squad Plataforma): no motor do Claude Agent SDK um agente que só lê numa execução não tem a guarda de caminho que o agente que escreve tem. Especificação de produto escrita em `1_SPEC.md`.
- Escopo do produto fixado em oito regras: quem conta como leitor (etapa de leitura, menção numa conversa de execução, pergunta da cadeia); as três ferramentas `Read`/`Grep`/`Glob`; raiz igual à pasta de trabalho (a pasta do ciclo dentro dela); o que é recusado (absoluto fora, `..`, `~`, link que sai, link que não leva a lugar nenhum, `.git`, arquivo de segredo); a recusa dita na conversa da execução e marcada como bloqueada na atividade ao vivo; não afrouxar segredo/censura de busca/busca ampla; campo próprio (`readRoot`), não `confine`.
- Critérios de aceite (11) e tabela de verificação escritos, todos marcados **não verificados**: esta etapa só leu código e issue; nada foi exercitado com agente ou modelo real.
- Nenhuma duplicata. A issue nasce da decisão **D6** aprovada no ciclo 30; #52 é vizinha (mesmo executor e pasta do ciclo), não duplicata.
- Prioridade proposta: `priority:high`, como a issue está rotulada. Marco: não se propõe.

## Restrições

- Bug de confinamento: não amplia nada, só restringe. **Não afrouxar** o filtro de arquivo de segredo, a censura de resultado de busca nem a recusa de busca ampla.
- O campo pedido é próprio (`readRoot`), **não** `confine`: `confine` também abre `Edit`/`Write` e o shell.
- As cerimônias (daily, unblock, retro) leem a pasta de projetos de propósito e ficam fora.
- Toda recusa vai para a conversa da execução e para a atividade ao vivo como bloqueada, como as outras recusas.
- Fontes de verdade conferidas por leitura: `src/main/engine/guard.ts` (`checkPath`, com `read: true` já julga leitura e libera a raiz), `src/main/runner/hooks.ts` (`readGuard` sobre `Read`/`Grep`/`Glob`, cada recusa relatada), `src/main/runner/executor.ts:430` (hoje `confine` só para quem escreve), `src/main/agents.ts` (`toolsOf`/`sdkOptions`/`extraDirs`, `extraDirs: call.confine ? [] : …` em 1055), `src/main/engine/open/loop.ts:264` (raízes do motor aberto).
- O trabalho de código ainda não existe: refinamento só leu.

## Tentado e descartado

- Nada foi tentado em código. As duas escolhas do handoff de support não viraram pergunta que pausa a etapa: as duas mudam escopo e são decisão da pessoa, então foram escritas na especificação como **propostas** (regras 8 e 9) e registradas em "Perguntas em aberto", seguindo a sugestão da triagem — lista explícita curta e derivada da configuração; raiz igual à pasta de trabalho quando ela existe. Ficam para a pessoa aceitar ou recusar.

## Perguntas abertas

- **Escolha de produto (não é pergunta a quem abriu):** as pastas de documentação listadas fora da pasta de trabalho ficam de fora ou entram por lista explícita? A configuração hoje entregue ao motor como diretórios adicionais do leitor (`agents.ts:1055`) tem de acompanhar essa decisão, senão o fechamento deixa o leitor sem acesso a elas.
- **Escolha de produto:** o alcance das menções e da cadeia de perguntas. Menção ou pergunta fora da conversa de uma execução não tem pasta de trabalho para servir de raiz; o contato de um squad chamado por um pedido lê o repositório do próprio squad.
- As duas vivem n'`1_SPEC.md` (regras 8 e 9 e a seção final), com a proposta da triagem como padrão.

## Onde o trabalho está

Refinamento concluído. `1_SPEC.md` traz o pedido nas palavras da issue, o que muda para quem usa, 8 regras, fora do escopo, 11 critérios de aceite, a tabela de verificação (tudo não verificado), prioridade e marco propostos e as duas perguntas em aberto. Nenhum código foi tocado. A próxima etapa (planejamento) projeta a solução a partir d'`1_SPEC.md`; a pessoa precisa confirmar as duas escolhas de escopo.
- Passagem support → product-owner: Refinamento do produto: confirmar as duas escolhas abertas antes de projetar a solução — (1) se as pastas de documentação listadas fora da pasta de trabalho ficam de fora ou entram por lista explícita, e (2) o alcance das menções e da cadeia de perguntas quando não há conversa de execução (canal, conversa geral) e o caso do contato de outro squad que lê o repositório do próprio squad. A triagem sugere lista explícita curta e derivada da configuração, e raiz igual à pasta de trabalho quando ela existir. Tipo: bug; não é duplicata; nenhuma pergunta a quem abriu. O trabalho começa em src/main/run… <!-- handoff:6 -->

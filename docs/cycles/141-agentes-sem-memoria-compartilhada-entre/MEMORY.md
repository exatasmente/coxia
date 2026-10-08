# Memória do ciclo

## Decisões

- Issue 141: pedido de funcionalidade. A memória das atividades deixa de ser por execução e passa a ser compartilhada, transversal a execuções, persistente entre reinícios e visível a um agente chamado fora daquela execução.
- Squad: plataforma. Comportamento especificado em `1_SPEC.md` (15 regras, 5 critérios) e desenho em `2_PLAN.md`.
- **Desenho decidido (plano):** a memória compartilhada não é documento que agente reescreve; é um **índice por atividade que o app projeta do estado que já guarda** (`Run`), arquivo `<workspace>/memory/activities.json` (pasta do espaço de trabalho, `ATAS`/`WORKSPACE_DIRS`), fora de todo worktree. Chave: `Run.issue.ref` (`release:X.Y.Z` e `docs:<repo>` incluídos), então uma segunda execução da mesma atividade é a mesma frente.
- Escritor: só o app, num ponto (função única dentro de `createRunner`, depois de `moveRun` em `move()` e nos movimentos assíncronos). Mescla por chave + escrita atômica; falha de escrita não derruba o movimento (logada e engolida) e o leitor reprojeta a frente do store de runs — perda silenciosa vira auto-recuperação.
- Criação interrompida (regra 8): registro mínimo da referência em `create()` antes do worktree/issue record; nunca removido pelo sweep; renderizado como "conhecida, nunca iniciada".
- Agente recebe **recorte renderizado**, nunca o índice: atividade nomeada (ref, título ou número) → frente inteira; agente nomeado → a frente dele + miniatura; nada nomeado → uma linha por atividade em andamento + aviso de que pode abrir uma; toda etapa → a frente da própria atividade inteira + lista compacta das outras. Teto por chamada (constante nomeada, contada em log), frente da atividade em questão nunca cortada. Seção própria entre `<data>` com aviso de material (não instrução), nos dois pontos de montagem: `mentions/call.ts` (todas as menções, dentro e fora de execução) e `runner/prompt.ts` (etapas); também nas chamadas de cadeia e num aviso ao agente que trabalha e recebe mensagem (caso do QA do relato). Nada entra em `allowedTools`/`extraDirs`/`roots`: a única saída da memória é texto no prompt.
- Antigo: nada apagado; frente mais velha que 30 dias renderiza como provavelmente encerrada; encerradas/antigas resumidas num fecho (a resposta é limitada, não o arquivo).
- Visível e corrigível sem modelo: `runs:activities` e `runs:activitySave` (abertos ao navegador como todo `runs:*`) e uma seção na tela que já lista as execuções; correção marcada como da pessoa e preservada na próxima projeção; sem recusa `memory-busy` (o arquivo não está no worktree).
- `MEMORY.md` por execução **não muda** (fora de escopo; entrega própria se virar redundante). `STEPS` de migração de config **não muda** (nenhum campo de `WorkspaceConfig`). AGENTS.md não muda.
- Riscos contidos: um escritor + mescla por chave; projeção pura; tetos numerados; índice nunca vira caminho de leitura nem sai da máquina (nenhum caminho novo escreve no host; `Actions` continua a única porta).

## Restrições

- Repositório público: nada de nome de empresa, pessoa, host, número real de issue ou segredo; placeholders neutros (`example.com`, `group/project`, `#123`).
- Todo texto de interface passa por `t()` nos dois catálogos; nada de cor literal no renderer (tokens de tema).
- Nenhum teste pode tocar modelo, host de código ou rede reais; fakes em `test/helpers/`.
- Código, testes, identificadores e commits em inglês; comentários dizem por quê.
- Efeito externo só por `Actions`; uma mudança de config exige degrau em `STEPS` e os três arquivos — esta não muda config.

## Tentado e descartado

- Arquivo único "das atividades, lido inteiro pela etapa": a etapa receberia o estado de todas as atividades, contra o teto de contexto que a spec manda demonstrar; descartado a favor do recorte por chamada.
- Índice no store de runs ou na pasta do ciclo: store é por execução (uma atividade teria N registros e nenhum lugar para as palavras da pessoa sem execução viva); pasta do ciclo está no worktree e iria ao pull request (regra 10). Descartados.
- Ler a pasta do ciclo de outras execuções para achar onde a atividade parou: proibido (confinamento de leitura dos agentes). Descartado; a frente é montada dos arquivos de run.
- Ferramenta de leitura da memória para o modelo: deixaria o modelo encher o próprio contexto sem o limite do app. Descartada.
- Nada implementado em código. Todas as etapas até aqui só leram; nenhum comportamento novo foi exercitado.

## Perguntas abertas

- Escopo da primeira entrega: o plano entrega frentes + miniaturas + tela juntas (recomendação da spec). Se a resposta for "primeiro as frentes e a consulta", o passo 2 perde os lugares fora de execução e o critério 1 não é cumprido.
- Crescimento: o plano limita a resposta (resumo do antigo), não o arquivo; se o arquivo também deve resumir o antigo, é entrega própria.
- Onde a pessoa edita: o plano põe a correção na tela das execuções; em Configurações seria a mesma parte de servidor e outra tela.
- Nota de lançamento: o plano escreve uma linha em `## [Unreleased]`; o texto é confirmado antes de publicar. Não verificado.

## Onde o trabalho está

- `0_TRIAGE.md` (tentativa 1), `1_SPEC.md` (tentativa 1, spec aprovada no Gate 1) e `2_PLAN.md` (tentativa 2, este plano): plano com decisões, ordem em 4 passos, um teste por comportamento com arquivo de teste, riscos e o que não foi verificado.
- Estado do código conferido por leitura: a memória do ciclo é arquivo de nome fixo na pasta do ciclo, no worktree da execução; um agente chamado numa conversa recebe só o fio e, na conversa de uma execução, os documentos daquela execução; o estado por execução (`Run`: etapas, etapa atual, pergunta, pendente, histórico, QA/review) existe e é a matéria-prima do índice; todo movimento de execução passa por `move()`/`moveRun`; menções fora de execução são respondidas por `mentions/module.ts`.
- Próxima etapa: implementação, passo 1 do plano. Prioridade proposta: `priority:high`; marco: próximo ciclo normal.
- Nada executado até aqui: nenhum teste, nenhuma interface, nenhuma chamada de modelo.
- Passagem support → product-owner: Escrever a especificação do comportamento: qual estado é compartilhado entre atividades, quem o lê e quando, como ele é atualizado ao longo de uma execução, onde ele persiste entre reinícios, e como isso aparece no prompt de um agente chamado fora de uma etapa. Cobrir os quatro critérios de aceite da issue como cenários verificáveis, incluindo o caso do agente de QA que respondeu não haver teste em andamento. Não decidir armazenamento nem formato agora além do que o comportamento exige. <!-- handoff:8 -->
- Passagem product-owner → pessoa: Escrever o plano técnico a partir de 1_SPEC.md: onde a memória compartilhada mora (fora do worktree, no que é do aplicativo naquele computador) e como é migrada do que existe hoje; como nasce e é mantida com uma frente por atividade; como o aplicativo a atualiza nos pontos da regra 3 (início da execução, entrada e saída de etapa, resposta da pessoa, recado para a próxima etapa, pergunta, cancelamento) sem que dois avanços simultâneos se apaguem; como ela entra no texto de um agente chamado em qualquer lugar (conversa de execução, canal de squad, conversa geral, conversa direta), com consulta p… <!-- handoff:15 -->

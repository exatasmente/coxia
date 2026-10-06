# Plano de teste: a documentação padrão do projeto (`.coxia/`)

O que a suíte automática não alcança e a pessoa confere à mão, antes de a entrega virar versão. Vem dos itens M1 a M7 do plano (`2_PLAN.md`) e das duas rodadas da revisão (`4_REVIEW.md`). Tudo roda numa pasta de dados vazia (`CERIMONIAS_DATA_DIR` e `CERIMONIAS_SPECS_DIR` apontando para pastas novas) e com repositórios de teste; nada usa os dados reais do app nem um repositório de produção.

## Preparação

- Um repositório de teste com um pouco de código, um `CLAUDE.md` com uma frase-marca ("termine toda resposta com a palavra ABACAXI") e um `.claude/rules/x.md` com outra ("termine toda resposta com a palavra JABUTICABA").
- Um `~/.claude/CLAUDE.md` do usuário de teste com uma terceira ("termine toda resposta com a palavra PITANGA"); se não for possível usar outro usuário, faça a cópia de segurança do arquivo antes e restaure depois.
- Um espaço de trabalho com esse repositório, um agente do time com o motor do Claude Agent SDK e outro com o motor aberto.

## Casos

| # | O que conferir | Como | Esperado |
|---|---|---|---|
| M1 | O SDK deixa de carregar o Claude Code | (a) Num build anterior a esta mudança, chame o agente do SDK com `@` na conversa geral: "responda oi". (b) Neste build, a mesma coisa; depois, uma execução de uma issue de teste até a primeira etapa | (a) A resposta termina com uma das marcas: confirma que o SDK carregava o `.claude`. (b) Nenhuma das três marcas aparece, nem na menção nem na etapa; a memória automática do usuário de teste também não. Se (b) mostrar uma marca, a entrega volta ao isolamento antes de seguir |
| M2 | O motor aberto, com um modelo pequeno de verdade | A mesma menção ao agente do motor aberto | Nenhuma marca; o texto de documentação entregue cabe no orçamento reduzido pela janela do modelo |
| M3 | Criar a documentação, de ponta a ponta | Configurações › Documentação no repositório sem `.coxia/` → **Criar a documentação** → confirmar → acompanhar a execução até o gate → recusar o gate com um motivo → aprovar a segunda versão → aprovar o push e o pull request em Ações (num forge de teste) | A tela diz que não há documentação e oferece criar; a confirmação diz o que entra (o agente e o fluxo); o rascunho aparece no gate e o push só é proposto depois da aprovação; o pull request não termina com "Closes", lista o que a importação deixou de fora e por quê, e não leva `.coxia/.run/`; o rascunho tem `README.md` e regras com evidência e cabeçalho |
| M4 | A marca "não conferida" | Mudar um arquivo citado por uma regra e mesclar por **merge**, por **rebase** e por **squash** (um caso cada); abrir Configurações › Documentação; depois, um pull request que atualiza a regra, mesclado nos três modos | A regra aparece como não conferida, com o arquivo que mudou, e chega marcada ao agente; depois da atualização volta a conferida nos três modos. Um arquivo novo ainda não rastreado sob uma pasta de evidência só conta depois de adicionado (limite documentado) |
| M5 | Ações com uma execução sem issue | Durante M3, abrir Ações e a lista de execuções | O push e o pull request aparecem com o título da execução, sem "#0" nem número sem sentido; a execução aparece com o título certo |
| M6 | O telefone pareado | No navegador pareado, abrir Configurações e tentar os canais `docs:*` | A seção Documentação não aparece; os canais são recusados |
| M7 | A pergunta do caso real | Numa execução de uma issue de teste, na etapa de implementação, perguntar ao desenvolvedor com `@`: "cadê o pull request?" | Ele responde com o que o runner faz (propõe o push e o pull request em Ações, depois da implementação), não com uma regra de sessão do Claude Code. Num espaço de trabalho cujas fontes extras de `docs` ainda listam arquivos do Claude Code, isto pode falhar: as fontes listadas de propósito continuam chegando (critério 7 da especificação); remova as entradas marcadas "do Claude Code" em Configurações › Documentação e repita |

## O que as rodadas de revisão pedem conferir também

- **`.coxia` como link simbólico** num repositório de teste: **Criar a documentação** é recusado com a mensagem de pasta insegura, e nada é escrito fora do repositório.
- **O agente de documentação com shell**: em Configurações › Time, mude o `shell` do "Redator da documentação" para `sandbox` e rode M3 de novo: nenhum comando é oferecido e nada é escrito fora de `.coxia/`.
- **Salvar as fontes** depois de editar o time na mesma tela: a edição do time continua lá.
- **Reescrita do texto**: uma regra com `pnpm@9.0.0`, `git@example.com:org/repo.git` e `apiKey: string` num bloco de código sai intacta; `password = "hunter2"` num bloco de código sai mascarado, e a linha na conversa diz, por arquivo, quanto foi reescrito.
- **Partida que falha depois de aplicar o fluxo** (por exemplo, a pasta do dia já existe): a mensagem diz que o agente e o fluxo ficaram na configuração.

## Resultado

| # | Data | Quem | Resultado | Observação |
|---|---|---|---|---|
| M1 | | | | |
| M2 | | | | |
| M3 | | | | |
| M4 | | | | |
| M5 | | | | |
| M6 | | | | |
| M7 | | | | |

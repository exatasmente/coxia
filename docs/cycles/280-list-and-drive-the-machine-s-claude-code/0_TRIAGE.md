# Triagem: sessões do Claude Code da máquina dentro do app

## Tipo

Pedido de funcionalidade (rótulo `enhancement`). Não é bug, pergunta nem duplicada.

## Dá para entender?

Sim, como está escrita. Conferido **só por leitura** da issue e de trechos do código; nada foi executado nem reproduzido.

O pedido: um recurso opcional (desligado por padrão, só no desktop) que lista as sessões do Claude Code da máquina (transcrições, em execução, em segundo plano), mostra a conversa ao vivo, e deixa a pessoa enviar mensagem, responder pedidos de permissão, parar e iniciar sessões, com auditoria de cada ação. Os limites (nunca ler credenciais, negado ao celular pareado, fora do alcance da persona, `test: true` recusa enviar/iniciar, nada de `~/.claude` em testes) e os critérios de aceitação estão explícitos.

## Conferido no código (leitura)

- `@anthropic-ai/claude-agent-sdk` ^0.3.292 está nas dependências; já há código que toca o SDK/`.claude` (por exemplo `src/main/sessions-core.ts`, `src/main/runner/tools.ts`). Não verificado: se a versão instalada expõe `listSessions`, `resume`, `forkSession` e `canUseTool` como a issue supõe.
- `src/main/persona/doorTable.ts` tem a tabela `EXCLUDED` citada pela issue.
- `src/main/webPolicy.ts` existe; a busca por um mecanismo de prefixo negado não achou nome óbvio (só um comentário sobre prefixos na linha 84). O plano precisa localizar onde entra o prefixo negado. Não verificado em detalhe.
- Existe `listSessions(dir)` em `src/main/engine/open/session.ts`, mas é de outro motor e não é o do SDK; não confundir.

## O que falta

Nada que bloqueie. Pontos para o plano, não para quem abriu:

- Como detectar sessões "em execução" e em segundo plano (`claude --bg`) sem abrir os arquivos de chave proibidos; a issue não diz a fonte.
- Como ligar o recurso (chave de configuração e onde aparece) e o nome do tipo de auditoria.
- Comportamento ao responder permissão quando a sessão foi iniciada por outro processo.

## Relacionadas

- #262: issue-mãe; esta é a divisão das entregas 1 e 2. A entrega 3 (canal autônomo) segue lá; não duplicar.
- #274: entrega 4 (reserva por orçamento), já entregue.
- #282: iniciar sessões do Claude Code com Remote Control, desligado por padrão; área vizinha, risco de sobreposição no ciclo de vida das sessões iniciadas pelo Coxia.

## Sugestões (não decisões)

- Prioridade: sugestão `priority:medium` (recurso opcional, grande, sem usuário bloqueado; toca a fronteira de segurança, então exige cuidado).
- Squad: `plataforma` (fronteira de segurança, `webPolicy.ts`, motores e auditoria), com apoio de `experiencia` para a tela.

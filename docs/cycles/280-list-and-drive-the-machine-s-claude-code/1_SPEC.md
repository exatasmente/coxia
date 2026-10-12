# Sessões do Claude Code da máquina dentro do Coxia: especificação

## O que muda para quem usa

Quem usa o Claude Code na mesma máquina passa a ver e conduzir essas sessões dentro do Coxia, sem trocar de programa. É um recurso opcional, desligado por padrão, só no app de desktop. Ligado, aparece uma tela com as sessões da máquina; abrir uma mostra a conversa e a atividade de ferramentas ao vivo; a pessoa pode mandar mensagem, aprovar ou negar pedidos de permissão, parar a vez em andamento e iniciar uma sessão nova numa pasta de projeto do workspace. Desligado, nada disso existe.

## Regras

1. O recurso fica desligado por padrão e só existe no desktop. Desligado, não há tela nem canal.
2. O Coxia usa o `claude` que a pessoa já instalou e no qual já entrou. Nunca oferece login e nunca lê, guarda ou repassa token. Nunca abre os arquivos de credencial e de chave da pasta do Claude Code (credenciais, chaves de sessão, chave do daemon).
3. A tela lista três grupos: transcrições (título, primeiro pedido, pasta, branch, última alteração), sessões em execução agora e sessões em segundo plano.
4. Abrir uma sessão mostra a conversa e a atividade de ferramentas conforme acontece, na mesma visão de atividade usada pelas execuções.
5. Todo texto de transcrição passa pela mesma ocultação de segredos que o resto do app.
6. Enviar mensagem retoma a sessão; se outro processo a mantém aberta, o envio parte de uma cópia (bifurcação) e a resposta chega ao vivo na tela.
7. Quando a sessão pede para usar uma ferramenta, o pedido aparece como item pendente para a pessoa, com permitir e negar, como os pedidos de limite de turnos. A sessão espera.
8. Só a pessoa responde a esses pedidos; agentes e a persona nunca respondem.
9. Parar interrompe a vez em andamento. Encerrar o processo só vale para sessões que o próprio Coxia iniciou.
10. A pessoa pode iniciar uma sessão nova numa pasta de projeto do workspace.
11. Cada mensagem enviada, permissão respondida e parada de sessão grava uma linha de auditoria com tipo próprio, citando a sessão.
12. O celular pareado recebe recusa em todos os canais do recurso desde o primeiro dia e não recebe nenhum evento dele. Os eventos vão só à janela do desktop.
13. A persona não alcança o recurso.
14. Workspace com `test: true` recusa enviar e iniciar (listar e ler continuam permitidos).
15. Nada da pasta do Claude Code da pessoa entra em testes ou dados de exemplo.
16. Se o `claude` não estiver instalado ou logado, a tela diz isso e não oferece login.

## Fora do escopo

- Canal autônomo (entrega 3 da issue-mãe #262): segue lá.
- Reserva por orçamento (entrega 4): já entregue em #274.
- Iniciar sessões do Coxia com Remote Control (#282).
- Acesso pelo celular pareado, ainda que somente leitura.
- Qualquer login ou gestão de credenciais.
- Delegar tarefa do runner a uma sessão (#281).

## Critérios de aceite

1. Com o recurso desligado (padrão), não há tela do recurso nem canal respondendo; ligar na configuração faz a tela aparecer.
2. Ligado, a tela lista transcrições, sessões em execução e sessões em segundo plano: abrir o Claude Code real numa pasta e conferir que aparecem.
3. Abrir uma sessão mostra a conversa; uma mensagem nova feita no Claude Code aparece sem recarregar.
4. Enviar uma mensagem pelo Coxia a uma sessão faz a resposta chegar e correr ao vivo na tela.
5. Com a sessão aberta em outro processo, o envio funciona numa cópia e a tela indica isso.
6. Um pedido de permissão da sessão aparece como item pendente; negar faz a sessão seguir sem a ferramenta; permitir faz a ferramenta rodar.
7. Persona e agentes não conseguem responder o pedido.
8. Parar interrompe a vez; sessão iniciada pelo Coxia pode ser encerrada, uma de outro processo não oferece encerrar.
9. A auditoria tem uma linha por mensagem, por resposta de permissão e por parada, com tipo próprio e a sessão citada.
10. Do celular pareado, todo canal do recurso recusa e nenhum evento chega.
11. Em workspace `test: true`, enviar e iniciar são recusados com aviso.
12. Um segredo presente numa transcrição aparece oculto na tela.

## Perguntas em aberto

- Não bloqueiam a especificação, mas o plano precisa resolver: de onde vêm as sessões em execução e em segundo plano sem abrir as chaves proibidas (a issue não diz a fonte).
- Se o SDK instalado oferece listagem, retomada, bifurcação e o gancho de permissão como a issue supõe: não verificado (o SDK não está instalado neste ambiente).
- Como o ciclo de vida das sessões iniciadas pelo Coxia se divide com #282.
- Nome da chave de configuração e do tipo de auditoria.

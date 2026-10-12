# Veja e conduza as sessões do Claude Code da sua máquina dentro do Coxia

## O que mudou

O Coxia ganhou um recurso opcional, desligado por padrão e disponível só no app de desktop. Ligado, uma tela lista as sessões do Claude Code da máquina em três grupos: conversas gravadas, sessões em execução e sessões em segundo plano.

Ao abrir uma sessão, a conversa e a atividade das ferramentas aparecem conforme acontecem. Dá para:

- enviar uma mensagem e ver a resposta chegar ao vivo;
- permitir ou negar os pedidos de permissão da sessão, que espera pela resposta;
- parar a vez em andamento;
- iniciar uma sessão nova numa pasta de projeto do workspace.

Se outro programa mantém a sessão aberta, a mensagem parte de uma cópia, e a tela avisa. Segredos nas conversas aparecem ocultos. Cada mensagem, resposta de permissão, parada e início fica na auditoria, citando a sessão (sem o texto da mensagem).

## Como usar

1. Nas Configurações, ligue o recurso de sessões do Claude Code.
2. Abra a nova tela no menu e escolha uma sessão.
3. Envie mensagens, responda aos pedidos de permissão, pare a vez ou inicie uma sessão pela própria tela.

O Coxia usa o Claude Code que você já instalou e no qual já entrou. Se ele faltar ou não estiver logado, a tela avisa; não há login no Coxia.

## O que vale saber

- Desligado, o recurso não aparece e nenhuma função dele responde.
- O Coxia nunca lê, guarda ou repassa credenciais ou chaves do Claude Code.
- O celular pareado não alcança o recurso nem recebe eventos dele; a persona e os agentes também não respondem às permissões.
- Em workspace de teste, enviar e iniciar são recusados; listar e ler continuam.
- Encerrar o processo só vale para sessões iniciadas pelo Coxia.
- Um pedido de permissão aparece no Coxia só para sessões que ele conduz; uma sessão aberta num terminal pergunta no próprio terminal.
- Ainda não verificado: o uso contra o Claude Code real e a tela num app aberto. Os testes automáticos usaram simulações.

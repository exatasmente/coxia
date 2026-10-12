# Remote Control opcional nas sessões do Claude Code do Coxia

## O que muda para quem usa

Hoje as sessões do Claude Code que o Coxia inicia (etapas de uma execução, chamadas, cerimônias) só podem ser acompanhadas no próprio Coxia. Passa a existir uma opção, **desligada por padrão**, para iniciar essas sessões com Remote Control, de modo que apareçam em claude.ai/code e no aplicativo Claude do celular. A pessoa escolhe onde vale: por agente ou por execução, nunca para todas as sessões de uma vez. Há uma variante mais leve, o espelho só de leitura (ver a sessão sem poder agir).

Na tela de sessões, a pessoa também pode ligar o Remote Control para uma sessão específica e retomar uma sessão no terminal com ele ligado; se uma etapa ainda segura a sessão, ela é bifurcada em vez de tomada.

Quem abre a sessão no celular recebe as ferramentas da própria sessão (editar arquivos, rodar comandos na worktree), fora das regras do celular pareado, do sandbox e das aprovações do Coxia. Por isso o controle é restrito e vem com aviso.

## Regras

1. Remote Control é desligado por padrão; nenhuma sessão do Coxia o usa sem escolha explícita da pessoa.
2. A escolha vale por agente ou por execução. Não há interruptor que ligue tudo de uma vez por padrão.
3. Quando agente e execução divergem, vale uma única precedência, mostrada à pessoa onde ela escolhe (a definir: ver perguntas em aberto).
4. O interruptor existe só no desktop: o celular pareado não o vê nem o aciona.
5. A persona não pode ligá-lo.
6. Um workspace com `test: true` recusa o interruptor, com mensagem clara.
7. Cada sessão aberta com Remote Control gera uma linha na auditoria.
8. Onde a pessoa liga, o app diz com clareza que isso contorna as regras do celular pareado (e o sandbox e as aprovações).
9. O espelho só de leitura mostra a sessão e não aceita entrada; é oferecido como a opção mais leve.
10. Na tela de sessões, ligar para uma sessão e retomar no terminal valem as mesmas regras 4 a 8. Se uma etapa segura a sessão, a retomada bifurca.
11. Todo texto novo passa pelos dois catálogos de idioma.
12. Se for descoberto que uma sessão iniciada pelo Agent SDK não consegue abrir a ponte, a opção não é ofertada como se funcionasse: o comportamento alternativo é decidido antes da implementação.

## Fora do escopo

- A tela de sessões, a bifurcação e a retomada no terminal em si (entregas 1 e 2 da #262): esta issue depende delas e só acrescenta o Remote Control.
- Ligar Remote Control para todas as sessões de uma vez.
- Qualquer uso no celular pareado ou pela persona.
- Mudar as regras do celular pareado, do sandbox ou das aprovações.
- Sessões do Claude Code iniciadas fora do Coxia.

## Critérios de aceite

1. Ligue a opção para um agente e rode uma etapa dele: a sessão aparece em claude.ai/code. Com a opção desligada, rode as mesmas etapas: nenhuma sessão do Coxia aparece lá.
2. Em instalação nova, a opção está desligada em todo agente e execução.
3. Abra o espelho só de leitura e tente enviar uma mensagem ou ação pelo claude.ai/code ou celular: a sessão é exibida e a entrada é recusada.
4. Em um workspace `test: true`, tente ligar: a recusa aparece com motivo.
5. No celular pareado, o interruptor não aparece e uma tentativa direta é negada.
6. Na persona, o pedido para ligar é recusado.
7. Abra N sessões com Remote Control: a auditoria mostra exatamente N linhas, uma por sessão, e nenhuma para sessões sem ele.
8. Onde a opção é ligada (agente, execução, sessão), o aviso sobre contornar as regras do celular pareado está visível antes da confirmação, nos dois idiomas.
9. Na tela de sessões, ligue para uma sessão solta e retome no terminal com ele ligado; com uma etapa segurando a sessão, a retomada cria uma bifurcação e a original não é alterada.
10. Quando agente e execução divergem, o resultado segue a precedência definida e a tela mostra qual valeu.

## Perguntas em aberto

- **Ponte em sessão não interativa (bloqueia a implementação, não a spec):** não verificado se uma sessão iniciada pelo Agent SDK consegue abrir a ponte (`remoteControlAtStartup`, `autoUploadSessions` são documentados só para sessões interativas). Saída: confirmação por teste real; se não der, decidir o comportamento alternativo (regra 12).
- **Espelho só de leitura:** não verificado se o Claude Code suporta de fato; se não, precisa de outro mecanismo ou deixa de ser oferecido.
- **Precedência entre agente e execução:** não decidida; proposta de partida: a escolha da execução vale sobre a do agente, mas só pode restringir (não ligar onde o agente está desligado)? Decisão de produto.
- **Dependência:** a issue de sessões (entregas 1 e 2 da #262) ainda não tem ciclo; a entrega daqui só começa depois dela. Se for preciso antecipar, o escopo muda.

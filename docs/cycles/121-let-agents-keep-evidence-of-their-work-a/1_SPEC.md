# O que um agente viu no trabalho fica guardado, com marcas na imagem

## O que se pede

A issue diz, nas suas palavras:

> An agent of a run can **keep** what it captured while it worked (a screenshot of the app, a page of the web UI, a log, a short report) as **evidence** of its stage, and can **mark up an image** to show what matters (a box around a field, an arrow to a button, a short label). QA uses it to back its scenarios, the product owner to record an exploratory validation, any agent to show what it saw. The person sees the evidence in the run, and it can go to the code host.

E o que acontece hoje:

> Today an agent with a sandbox saves captures in `/coxia/out` and looks at them with `ViewImage` (`src/main/sandbox/session.ts`, `readOutputImage`), but the folder is removed when the stage ends: nothing is kept, nothing is shown to the person, and nothing points at a capture from a QA scenario.

A issue pede quatro partes: guardar a comprovação; marcar a imagem; usar a comprovação (cenário de QA, saída de etapa, telas); e levá-la ao host de código dentro de um comentário ou da descrição do pull request. A abertura e cada parte, citadas:

> ### 1. Keeping evidence
>
> - A tool, **`SaveEvidence`**, takes a file the stage made in its output folder (never a path elsewhere, never through a link; kind checked by content; size capped) with a title and an optional description, and keeps it as evidence of the stage. It answers with an evidence id.
> - Evidence is a message attachment of the run's conversation, posted by the agent, so the person sees it live, and it is listed on the stage in the run's screen.
> - Where it is kept is a workspace choice in Settings › Runner:
>   - **App data only** (default): kept with the run in the workspace's data, never in the repository.
>   - **Also in the cycle folder**: also copied to `docs/cycles/<n>-<slug>/evidence/` and committed with the stage, so it reaches the pull request.
>
> ### 2. Marking up an image
>
> - A tool, **`AnnotateImage`**, takes an evidence image (or an image of the output folder) and a list of marks, and makes a **new** image; the original is kept. Marks: rectangle, arrow, ellipse, text label, numbered marker, and a blur box (to hide what should not be seen). Coordinates in pixels of the image, colour from a short fixed list, line width capped.
> - The agent can look at the result (`ViewImage`) and annotate again; each version is its own evidence, linked to the one it came from.
> - Drawing happens in the app's main process from data (no program of the agent runs on the host).
>
> ### 3. Using it
>
> - A QA scenario can cite evidence ids next to command numbers; the run's QA view shows the evidence by scenario. An `executed` scenario still needs a command; evidence alone does not make it executed.
> - The stage output of any agent can cite evidence ids (the product owner's exploratory validation, a review finding).
> - The person can open, download and delete evidence from the run's screen and the paired browser.
>
> ### 4. To the code host
>
> - A stage comment (QA's, the product owner's) or the pull request description can carry the evidence it cites: the images are uploaded to the code host and embedded in the comment.
> - That goes through the door of Actions like any other write: an autonomous agent's goes out by itself and is audited, any other waits in Actions with the images shown. A test workspace refuses it. The comment check applies to the text; the person sees every image before a "yes".
> - Each provider uploads in its own way (GitHub, GitLab, Bitbucket): the spec must say what each one supports and what happens where it cannot (the comment says how many evidence files there are and that they are in the app).

E a nota final:

> Functional specification only; the solution design belongs to refinement and planning. The repository may be public: the spec must say what keeps a capture of private data out of a commit and out of a comment (the blur mark, the review before a "yes", the default of app data only).

## O que muda para quem usa

- Um agente que trabalha numa execução deixa de perder o que capturou. O que ele guardar como comprovação é publicado na conversa da execução, na hora, com um título, uma descrição opcional e os documentos da etapa à vista; a pasta onde as capturas eram feitas continua sumindo com a etapa, mas a comprovação fica, no espaço de trabalho e marcada na etapa da tela da execução.
- Uma imagem pode ser marcada para mostrar o que importa — um retângulo em volta de um campo, uma seta para um botão, um rótulo curto — e a imagem original continua guardada. A marca de borrão existe para esconder o que não deve ser visto.
- O cenário de QA passa a poder citar comprovações ao lado dos números de comando, e a tela de Revisão e QA mostra as comprovações de cada cenário. Citar uma comprovação não faz um cenário valer como executado: `executed` continua precisando de um comando.
- A comprovação aparece na conversa e na tela da execução, onde a pessoa abre, baixa e apaga; e a pessoa vê a mesma coisa no navegador pareado.
- O espaço de trabalho escolhe, em Configurações › Runner, se a comprovação fica só nos dados do app (o padrão) ou se também é copiada para a pasta do ciclo e entra no commit da etapa, alcançando o pull request. No padrão, nada de comprovação aparece num commit.
- Quando a comprovação é citada no comentário de uma etapa ou na descrição do pull request, a imagem é enviada ao host de código e sai embutida no comentário. Um agente autônomo publica sozinho, como qualquer outra escrita dele, e o que sai fica registrado; qualquer outro caso espera o "sim" em Ações, com as imagens à vista antes de confirmar. Um espaço de trabalho de teste recusa a publicação.
- O que cada host suporta é dito na hora de publicar; onde embutir não for possível, o comentário diz quantas comprovações existem e que elas estão no app, em vez de sumir com elas sem dizer nada.
- Fora do app nada muda: os comandos do agente continuam onde estão e o commit da etapa continua sendo do app.

## Regras

### 1. Guardar a comprovação

1. **Só o que a etapa produziu.** O que se guarda é um arquivo que a própria etapa fez na pasta de saída dela, e nunca um caminho de outro lugar nem um caminho que passe por um link. Qualquer outra origem é recusada, com o motivo.
2. **O que é aceito e o que é recusado.** Formatos aceitos: imagem (por exemplo PNG, JPEG, GIF e WebP), registro de texto (`text/plain`) e relatório curto (texto ou PDF). O tipo é conferido pelo conteúdo do arquivo, não pelo nome nem pela extensão: um arquivo que se diz imagem e não é imagem é recusado, e o motivo diz que o conteúdo não é o formato declarado. Um arquivo que passa do teto de tamanho é recusado e o motivo diz o teto. Aceito: PNG, JPEG, GIF, WebP; `text/plain`; PDF. Recusado: vídeo e gravação de tela (fora do escopo por decisão da issue), áudio, arquivo compactado, executável, e qualquer arquivo que o conteúdo não confirme.
3. **Título e descrição.** Toda comprovação tem um título, e pode ter uma descrição. É o que a pessoa lê na conversa e no que aparece listado na etapa.
4. **Um id de comprovação.** A ferramenta responde com uma comprovação, identificada por um id curto e estável, que não muda de uma execução para outra nem é reaproveitado. O formato é `ev-<algarismos>` (por exemplo `ev-3`), sem significado que a pessoa precise entender; é o que citam o cenário de QA e a saída da etapa, e é o que a tela mostra.
5. **A comprovação é da etapa.** O que se guarda é comprovação da etapa que o guardou: aparece listada naquela etapa, na tela da execução, e é dela que vem o agente que a publicou na conversa. O id de uma comprovação de outra etapa não é aceito como se fosse desta, e o motivo diz isso.
6. **Na conversa da execução.** A comprovação é publicada na conversa da execução na hora em que é guardada, com o documento anexo, para a pessoa ver ao vivo.
7. **Onde fica.** A escolha é do espaço de trabalho, em Configurações › Runner, e vale para as comprovações novas a partir de então:
   - **Só nos dados do app** (padrão): fica nos dados do espaço de trabalho, junto da execução, e nunca num commit. Vale também para uma configuração guardada antes de o campo existir: sem o campo, é este padrão, e nada de comprovação entra no commit.
   - **Também na pasta do ciclo**: além disso, uma cópia vai para a pasta de comprovações da pasta do ciclo e é levada no commit da etapa — é o que a comprovação citada chega a ter no pull request.
8. **É um anexo, e essa base vem junto.** A comprovação é um anexo da mensagem da conversa da execução — a mesma forma de anexo que carrega um arquivo numa mensagem —, e não um arquivo solto que a tela procura por conta própria. Hoje essa forma de anexo não existe: a mensagem da conversa só aponta para documentos que o app publicou, e o armazenamento que guarda os bytes de um arquivo anexado, com os limites e o tipo conferido pelo conteúdo, também não existe. Como o trabalho que a issue citava como base não está pronto na linha principal do repositório, ele entra nesta issue, junto com a comprovação: o armazenamento de anexos e a mensagem que carrega arquivos são pré-requisito interno desta entrega, não algo a esperar de fora. Todo o resto da spec — as regras de guardar, marcar, usar e levar ao host — passa a contar com essa base.
9. **Some com a execução.** As comprovações de uma execução são apagadas quando a execução é removida. O que já foi publicado no host não é apagado por isso. Quando a pessoa escolheu "também na pasta do ciclo", a cópia que entrou num commit já publicado segue a sorte do repositório: tirá-la de lá é um commit novo, e a tela diz isso.
10. **A guarda de escrita continua.** Guardar uma comprovação não dá ao agente nenhuma escrita nova no repositório: a cópia na pasta do ciclo entra no commit que o app já faz, e é o app que commita.

### 2. Marcar a imagem

11. **Uma imagem nova, a original guardada.** A ferramenta recebe uma comprovação de imagem ou uma imagem da pasta de saída e uma lista de marcas, e produz uma imagem nova. A original nunca é alterada, e continua lá.
12. **As marcas.** Retângulo, seta, elipse, rótulo de texto, marcador numerado e caixa de borrão. O borrão é a marca que esconde o que não deve ser visto.
13. **Como a marca é descrita.** Coordenadas em pixels da imagem, cor de uma lista curta e fixa de cores, e espessura da linha com teto. Um valor fora da imagem, uma cor fora da lista ou uma espessura acima do teto é recusado com o motivo; nada é desenhado em cima do que a lista não permite.
14. **Cada versão é uma comprovação.** Cada imagem marcada é uma comprovação por si, ligada àquela de que veio; uma cadeia de versões tem todas as versões guardadas, não só a última.
15. **O resultado pode ser olhado.** O agente consegue olhar para a imagem que produziu e marcar de novo em cima dela; com isso o ciclo "capturar → marcar → olhar → marcar de novo" se fecha sem o agente precisar de nenhuma janela. Olhar é uma capacidade a construir nesta entrega: hoje nenhuma ferramenta de imagem existe no runtime, e as duas que a issue citava como prontas (`ViewImage` e a leitura da imagem da pasta de saída) não existem na linha principal do repositório. Elas entram aqui.
16. **O desenho é do app.** O desenho acontece no processo principal do app a partir dos dados das marcas: nenhum programa do agente roda no computador para desenhar. Vale para as quatro partes.

### 3. Usar a comprovação

17. **No cenário de QA.** O cenário pode citar ids de comprovação ao lado dos números de comando, e a tela de Revisão e QA mostra, por cenário, a comprovação que ele citou.
18. **Comprovação não é execução.** Um cenário `executed` continua precisando de um comando; citar uma comprovação não muda a marca do cenário, e o app continua conferindo a afirmação como já faz. A comprovação embasa o que o cenário diz, não o que o app conta como executado.
19. **Na saída de qualquer etapa.** A saída de etapa de qualquer agente pode citar ids de comprovação: a validação exploratória do Product Owner, um achado da revisão, e assim por diante.
20. **A pessoa manda na comprovação.** A pessoa abre, baixa e apaga uma comprovação na tela da execução e no navegador pareado. Apagar uma comprovação é ação da pessoa; um agente pode guardar, mas não apagar.
21. **A comprovação como ela é.** A imagem anexa é aberta na conversa, no cenário e na tela. Não há edição da comprovação à mão no app (fora do escopo por decisão da issue); o que existe é guardar e marcar pelo agente, e abrir, baixar e apagar pela pessoa.

### 4. Levar ao host de código

22. **O que pode carregar comprovação.** O comentário de uma etapa (o da QA, o do Product Owner, o de qualquer agente) e a descrição do pull request podem levar as comprovações que citam: a imagem é enviada ao host de código e sai embutida no texto.
23. **A porta de sempre.** Publicar uma comprovação passa pela porta das Ações como qualquer outra escrita: a de um agente autônomo sai sozinha e é registrada, e a de qualquer outro agente espera um "sim" em Ações, com as imagens à vista antes de confirmar. Um espaço de trabalho de teste recusa. O push e o pull request continuam esperando o "sim" sempre, como hoje.
24. **A conferência do texto não julga a imagem.** A conferência de vocabulário do comentário vale para o texto; as imagens que o agente cita saem como vieram (é o que o próprio repositório diz de hoje: um endereço ou uma imagem que o agente escreve sai como foi escrito). Por isso a pessoa vê cada imagem antes de um "sim" e, num agente autônomo, o que a comprovação protege é o passo do item 25.
25. **Nada de privado para um commit ou um comentário.** Um repositório pode ser público, e a comprovação não pode levar segredo, token, contato ou dado privado para um commit nem para um comentário. As travas, todas as quatro: o padrão **só nos dados do app** mantém toda comprovação fora do commit, salvo quando a pessoa escolhe o contrário; o **borrão** é a marca que esconde o que não deve ser visto, e é a única maneira de fazer isso dentro do app; a **revisão antes do "sim"** faz a pessoa ver cada imagem antes de a escrita de um agente que espera sair; e a comprovação guardada **só o que a etapa produziu**, com o tipo conferido pelo conteúdo, não é um caminho para pendurar um arquivo qualquer de qualquer lugar no comentário.
26. **O que cada host suporta.** O envio é por provedor, e o que cada host suporta é dito na hora: onde embutir uma imagem não for possível, o comentário diz quantas comprovações existem e que elas estão no app, em vez de omitir ou quebrar. O que os provedores suportam conforme a documentação do repositório — nenhum host real foi usado neste projeto:
   - **GitHub**: comentários de issue e de pull request aceitam imagem embutida por um endereço `https://github.com/user-attachments/assets/...` que o próprio host devolve quando a imagem é enviada com o token no cabeçalho de autorização; a imagem aparece embutida no texto.
   - **GitLab**: upload de arquivo do projeto (`POST /projects/:id/uploads`), que devolve um endereço em Markdown; a imagem aparece embutida.
   - **Bitbucket Cloud**: comentário de pull request tem a forma de conteúdo por `raw`; a imagem embutida depende da versão e da forma aceita pelo host. Como o Bitbucket não é seguro quanto a isso, uma comprovação citada por um comentário de pull request desse host pode virar o texto "quantas comprovações existem e que estão no app".
   - Em nenhum dos três a comprovação que só está nos dados do app é enviada sem ser citada; a imagem só sai quando alguém a cita.
27. **O que fica publicado.** O que fica no comentário publicado é a imagem e o que o texto diz; apagar a comprovação no app depois de publicada não apaga o comentário, e a tela da execução diz isso.

## Fora do escopo

- Vídeo e gravação de tela (decisão da issue).
- Editar a comprovação à mão no app: recortar, desenhar, arrastar uma marca, apagar uma marca (decisão da issue).
- Enviar uma comprovação ao host sem que alguém a cite, ou publicar a conversa da execução no rastreador.
- A comprovação virar um documento da pasta do ciclo ao lado dos documentos de etapa: ela não é artefato de etapa, não entra no `produces` nem no `reads` de nenhuma etapa.
- Anotar documento que não seja imagem, ou ler o texto dentro do desenho.
- Desenhar qualquer coisa que não venha de uma lista de marcas: a imagem é marcada pelo agente, a partir de dados, e não há um programa dele rodando no computador para desenhar.
- Escolher o provedor de envio por conta própria: vale a integração que o espaço de trabalho já usa para as issues.
- Automatizar a borra: a marca de borrão é posta pelo agente, e o app não procura sozinho o que esconder.
- Esperar de fora a base de anexos: como o trabalho que a issue citava como base não está pronto na linha principal, ele entra nesta entrega (regra 8) e não é escopo de outra issue.

## Aceitação

Cada item é algo que uma pessoa consegue conferir.

1. Um agente de QA numa sandbox tira uma captura de tela, guarda com `SaveEvidence`, desenha um retângulo e uma seta com `AnnotateImage` e cita o resultado num cenário que falha: a pessoa vê as duas imagens na conversa da execução e, embaixo, no cenário, a comprovação que ele citou. A imagem guardada aparece como anexo da mensagem da conversa, e a mensagem carrega as duas.
2. Com o padrão, nenhum arquivo de comprovação aparece no commit da etapa e nenhum aparece no pull request; com "também na pasta do ciclo", os arquivos de comprovação estão no commit da etapa.
3. O comentário de QA de um agente autônomo sai com a imagem marcada embutida; o de um agente que espera fica em Ações com a imagem à vista, e só sai com o "sim"; num espaço de trabalho de teste a confirmação é recusada.
4. Um caminho fora da pasta de saída, um caminho que passa por um link, um arquivo acima do teto e um arquivo cujo conteúdo não é o tipo declarado são recusados, cada um com o motivo à vista.
5. As comprovações de uma execução são apagadas com a execução; apagar uma comprovação antes de ela ser publicada não deixa nada no pull request, e o que já foi publicado no host não é apagado por isso.
6. Uma comprovação guardada aparece listada na etapa que a guardou e publicada na conversa da execução na hora.
7. A imagem marcada é uma comprovação nova, ligada àquela de que veio, e a imagem original continua lá.
8. Uma marca com uma cor fora da lista, uma coordenada fora da imagem ou uma espessura acima do teto é recusada com o motivo, e nada é desenhado no lugar errado.
9. Um cenário que cita uma comprovação sem citar comando continua registrado como `read`, e o app continua dizendo que um `executed` sem comando que o sustente não se sustenta.
10. A pessoa abre, baixa e apaga uma comprovação na tela da execução e no navegador pareado.
11. Um host que não aceita a imagem embutida faz o comentário dizer quantas comprovações existem e que estão no app — a publicação não quebra nem some com a informação.
12. O envio de uma imagem ao host aparece em Ações antes de sair, como qualquer outra escrita, e fica registrado quando sai sozinho.
13. Sem a base de anexos, a comprovação não é guardada nem publicada; com a base desta entrega, o arquivo guardado aparece como anexo da mensagem da conversa, com nome e tipo à vista.

## Como foi conferido

Esta etapa é de refinamento, não de exercício. Conferido por leitura, nesta cópia de trabalho, cada afirmação sobre o que existe hoje:

- A pasta de saída da sandbox existe e é `/coxia/out` (constante no módulo de política da sandbox), e as capturas que um agente com sandbox faz vão para lá.
- A pasta da etapa é apagada quando a etapa termina, e com ela a saída: não sobra comprovação de nada. Confere com o que a issue relata.
- A ferramenta `ViewImage` e a função `readOutputImage`, que a issue cita como existentes, **não existem** nesta cópia nem na linha principal atualizada: só aparecem no texto da própria issue. Por isso entram nesta entrega (regra 15).
- Não há armazenamento de anexos em `src/` nem em `test/`, e a mensagem da conversa não tem campo de anexo: é isso que a issue chama de apoio, e entra nesta entrega (regra 8).
- O cenário de QA tem a comprovação por comando: cada cenário guarda `executed` ou `read` e os números dos comandos que cita, e o app confere a afirmação. Imagem em cenário não existe.
- A escolha de onde guardar a comprovação não existe: a aba do runner é onde ficam o trabalho da execução, os limites da sandbox e as identidades, e não tem nada sobre comprovação nem sobre a pasta de saída.
- A porta de Ações existe: uma escrita externa feita por agente autônomo sai registrada e a dos outros espera um "sim"; um espaço de trabalho de teste recusa a confirmação.
- Nenhuma biblioteca de desenho de imagem está nas dependências, e o processo principal não desenha imagem: conferido nas dependências do repositório.

O pré-requisito declarado pela própria issue (o armazenamento de anexos e a forma como uma mensagem carrega arquivos) foi procurado no histórico do repositório depois da resposta da pessoa, que apontou que a cópia podia estar desatualizada. Conferido: a linha principal do repositório, já atualizada pelo `git fetch`, está no mesmo ponto em que a cópia estava, e nada de anexos entrou nela — nenhuma menção no changelog nem no código da linha principal. O que existe no histórico são os documentos de outra issue (registro, triagem, refino e plano), em outra ramificação, que descrevem onde o anexo ficaria (`workspaces/<id>/…`), que o tipo seria conferido pelo conteúdo e que a mensagem passaria a carregar os arquivos; esse trabalho não está na linha principal. Pela resposta da pessoa — "se não existir deve ser criado" — o que falta entra nesta entrega (regra 8). Não verificado: se essa outra ramificação será mesclada, e portanto uma parte da base pode chegar de fora em vez de ser construída aqui.

Nada foi executado, nenhuma tela foi aberta e nenhum fluxo foi rodado nesta etapa. Não verificado: que um provedor real aceite o envio e o embutimento da imagem (a documentação do repositório diz que GitHub, GitLab e Bitbucket nunca foram exercitados num host real); que a intent de configuração aceite o campo novo; e o comportamento em tela das quatro partes.

## Prioridade e marco propostos

- **Prioridade: uma prioridade alta** — o nível mais alto dos que o espaço de trabalho escreve no host de código (como `P1` no exemplo da documentação). Motivo: é capacidade nova, mas é a **única** trava que o produto tem hoje entre um agente que trabalha e o que a pessoa vê: sem ela, o que um agente faz fora do diff — uma captura do app, uma página da interface web — some com a etapa, e o QA não tem como embasar um cenário com o que viu. É também a única comprovação que a pessoa pode abrir, baixar e apagar. A prioridade final é da pessoa.
- **Marco: 0.7.0** (a próxima versão menor depois da 0.6.1), por ser capacidade nova e visível, com escolha de espaço de trabalho e telas novas. A lista de marcos do rastreador não foi alcançada nesta etapa, então o marco fica como proposta a confirmar.

## Perguntas em aberto

1. **Onde publicar.** Hoje a publicação de um comentário de etapa é pela autonomia do agente. **A publicação da imagem deve seguir a autonomia (o autônomo publica sozinho) ou esperar sempre o "sim", como o push e o pull request?** A issue fala pela autonomia; a decisão é da pessoa, porque uma imagem pode carregar um dado privado que a conferência de texto não pega.

A pergunta sobre o pré-requisito e sobre o que a issue citava como pronto foi respondida pela pessoa: a cópia podia estar desatualizada, era para conferir e, se não existisse, criar. Conferido que não existe na linha principal, a spec passou a incluir o que falta (regra 8 e regra 15), e o que resta do caso está na seção "Como foi conferido".

## Nota de lançamento

Uma execução deixa de perder o que um agente viu: o que ele guardar como comprovação da etapa fica no espaço de trabalho e aparece na conversa da execução, com um título e uma descrição opcional. Uma imagem pode ser marcada para mostrar o que importa — um retângulo, uma seta, uma elipse, um rótulo, um marcador numerado — e a marca de borrão esconde o que não deve ser visto, com a imagem original guardada ao lado. Um cenário de QA pode citar comprovações, e um cenário ainda precisa de um comando para valer como executado. O espaço de trabalho escolhe se a comprovação fica só nos dados do app (o padrão) ou também na pasta do ciclo, entrando no commit da etapa; e, quando uma comprovação é citada num comentário de etapa ou na descrição do pull request, a imagem é enviada ao host de código e sai embutida, passando pela mesma porta das outras escritas — registro para um agente autônomo, "sim" em Ações para os demais, recusa num espaço de trabalho de teste. Uma comprovação some quando a execução é removida.

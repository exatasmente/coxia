# O projeto passa a ter um site de documentação publicado no host de código

## O que se pede

O pedido, nas palavras da própria issue:

> The repository publishes a documentation site on GitHub Pages: a landing page, a guide (install, first workspace, first ceremony, first run), the reference documentation already in `docs/`, use cases (one developer with a team of agents; a run from issue to pull request; an agent on a virtual screen handed to the person for a login; the paired phone approving an action), and a blog whose first posts come from the release notes. Agents of the app write and maintain it through the normal cycle; the person turns Pages on once and gives the yes at the pull request.

E o que a issue registra como estado de hoje, também citado:

> - `docs/` has the reference documentation, bilingual in places (`README.md`, `docs/llm-providers.md`), with `docs/images/` holding only a README.
> - The repository's `README.md` still says "Status: 0.1, first public version" while 0.8.0 is released and 0.9.0 is in beta.
> - `CHANGELOG.md` is written in prose per feature: it is the raw material of the blog and of the use cases.

A issue deixa cinco dúvidas para o refino; a seção **O que o refino decidiu** fecha as que são de escopo e diz quais ficam com o plano.

## O que muda para quem usa

Quem chega ao projeto hoje encontra um repositório: o README, uma pasta de documentos e um histórico de mudanças. Depois desta mudança encontra também um **site publicado**, no endereço do projeto, que abre com uma página que diz em uma tela o que o produto é e leva, dali, ao guia de primeiros passos, à documentação de referência, a casos de uso e a um blog.

O guia tem o caminho de quem está começando: instalar, criar o primeiro espaço de trabalho, fazer a primeira cerimônia e acompanhar a primeira execução conduzida pelos agentes. A referência é a mesma documentação de hoje, acessível pelo site, sem uma segunda cópia que envelhece. Os casos de uso contam situações inteiras — uma pessoa com um time de agentes, uma execução de issue até o pedido de merge, um agente numa tela virtual entregue à pessoa para um login, o celular pareado aprovando uma ação. O blog abre com o texto de cada versão publicado, escrito a partir do histórico de mudanças, e o site também mostra esse histórico numa página própria, que segue o arquivo do repositório em vez de copiá-lo.

A linha de status do README deixa de dizer a versão de estreia: diz a versão atual e leva ao site.

Para a pessoa que mantém o projeto, o site é **trabalho de agente, não trabalho manual**: um agente do time escreve e mantém as páginas pelo ciclo normal, e o que chega ao site vem de uma mudança revisada e mesclada, como qualquer outra. A única coisa que ela faz fora do ciclo é ligar a publicação uma vez, na configuração do repositório, no host. Nada no aplicativo mexe nessa configuração.

A partir daí, mudar a documentação de referência ou o histórico de mudanças passa a mudar o site sozinho, na mesma mesclagem, sem nenhum passo novo além do "sim" de sempre.

## Regras

1. **O site mora no repositório, numa pasta própria.** Fica em `site/`, versionado com o código; o gerador é o de toolchain da casa (VitePress). A referência não é copiada para dentro do site: é incluída a partir de `docs/`, que continua sendo a fonte que os agentes do aplicativo leem em tempo de execução. Nenhum documento de referência muda de lugar por causa do site.
2. **A publicação é um fluxo do repositório.** Um fluxo de integração contínua publica o site a cada push na branch padrão, pela fonte de GitHub Actions. A pessoa liga a publicação **uma vez**, na configuração do repositório, no host; o aplicativo não escreve configuração de repositório nem de publicação, e a issue diz que é assim.
3. **Toda página existe nas duas línguas da casa**, o inglês primeiro, com a versão em português do Brasil ao lado, como os dois README de hoje. Nenhuma página existe só numa língua; a página em inglês e a em português dela são alcançáveis uma da outra.
4. **As seções do site são as que a issue lista:** a abertura, o guia, a referência, os casos de uso, o blog e a página do histórico de mudanças. Nenhuma delas fica de fora.
5. **A referência é alcançável de verdade.** Cada página da documentação de referência de hoje é alcançável a partir do site, com um endereço próprio. Um documento de referência novo passa a ter endereço no site quando entra na documentação, sem uma lista paralela para manter.
6. **O histórico de mudanças tem página, e ela segue o arquivo.** A página é gerada do arquivo do repositório na hora de construir o site; não existe uma segunda cópia do histórico versionada, e por isso ela não pode divergir.
7. **O blog abre com o texto de cada versão, a partir do histórico.** O primeiro texto é o da versão estável publicada (a que a issue cita: 0.8.0); cada versão seguinte ganha o seu, escrito a partir da seção daquela versão no histórico de mudanças, e textos sobre o que os agentes aprenderam também cabem.
8. **As imagens vêm do próprio aplicativo, de um espaço de trabalho fictício; até elas existirem, só texto e espaços reservados.** O site nunca usa uma captura com dado real de uma pessoa, de uma empresa ou de um host. O trabalho de capturas é outro pedido (o das imagens da documentação, que semeia um espaço de trabalho com dados fictícios e é refeito a cada versão); enquanto ele não chega, cada lugar que pede imagem mostra texto e um espaço reservado, nunca uma tela real.
9. **As regras de repositório público valem para cada página do site.** O que a issue escreve: "no company, person, host or real issue number; placeholders stay neutral" — e o que o repositório já faz: a auditoria pública roda sobre as fontes do site, como roda sobre o resto da árvore (arquivos versionados e não ignorados). Um texto do site que carregue nome de empresa, de pessoa, de host, número real de issue ou credencial é tratado como defeito, e os exemplos usam os espaços reservados neutros dos documentos de hoje.
10. **O site tem as suas próprias checagens, e elas rodam junto do resto.** "the site builds, links resolve, both languages have every page": a construção do site, a resolução dos links (nenhum apontando para uma página que não existe) e a existência das duas línguas em toda página. Uma checagem que reprova não é site pronto.
11. **O site é conferido de dentro do aplicativo.** A issue pede as duas formas: um agente cujos hosts permitidos incluam o endereço publicado abre o site no navegador do próprio aplicativo e guarda uma captura como comprovação da etapa; e a prévia local, antes de publicar, é conferida com o navegador automatizado do repositório, no endereço local da máquina, dentro da sandbox da etapa.
12. **A linha de status do README diz a versão atual e leva ao site.** Vale para o README em inglês e para o em português, que hoje dizem a mesma linha atrasada.
13. **A publicação não inventa um passo novo para a pessoa.** Deixar ligada a publicação é o ato único; depois disso, uma mudança na documentação de referência ou no histórico de mudanças que entra pela mesclagem atualiza o site, dentro do mesmo fluxo, sem nenhuma ação além do "sim" de sempre.
14. **O site é mantido pelo ciclo normal.** Quem escreve as páginas é um agente do time da pessoa, pelo fluxo de documentação do aplicativo, com o "sim" nos gates de sempre: o mesmo caminho pelo qual qualquer outra mudança do repositório é revisada e mesclada. Um agente com sandbox encaminhado à pasta do site é um agente da pessoa; ele não muda o agente que hoje só escreve o arquivo de instruções da raiz.

## O que o refino decidiu

As perguntas que a issue deixou para o refino, e onde cada uma fica:

- **Gerador: o de toolchain, e não o de Jekyll.** VitePress (a escolha declarada nesta spec e o que a triagem descreve do repositório: Vite e electron-vite já estão no projeto). O peso da ferramenta é aceito em troca de uma abertura que parece um produto, que é o que a issue pede para comparar. *Decisão do refino; a issue deixava em aberto.*
- **A pasta do site é `site/`.** Versionada com o código, na varredura da auditoria pública como está hoje (o repositório não ignora pasta de site alguma). *Decisão do refino.*
- **A referência é incluída de `docs/`, nunca copiada.** É a preferência que a própria issue declara (a pasta é lida pelos agentes em tempo de execução) e a regra 1 a fixa. *Decisão do refino.*
- **O agente de documentação e o caminho dele à pasta do site.** A issue registra que o agente do fluxo de documentação escreve só o arquivo de instruções da raiz, sem shell e sem rastreador, e que o site precisaria de um agente da pessoa com sandbox encaminhado à pasta do site. A spec fica com o comportamento (regra 14) e a recomendação: um agente novo, do time da pessoa, com sandbox e encaminhamento à pasta do site, na pasta de squad que responde pelo runtime e pela infraestrutura do repositório. **A escolha exata do agente, do fluxo e do encaminhamento é do plano técnico, que responde o que a decisão muda quando o agente que existe hoje é reaplicado numa configuração que já o tem.**
- **Domínio próprio: fora do escopo.** Ele custa dinheiro e aceita termos, e cai na regra de efeito externo como decisão separada; nada nesta mudança depende dele. A issue já diz que assim é.

## O que fica fora

- **Domínio próprio.** Não agora e não por esta mudança; se for desejado, é uma decisão à parte, com o custo e os termos na mesa.
- **Que o aplicativo ligue a publicação ou escreva configuração de repositório.** Nada no aplicativo passa a escrever configuração de Pages ou de repositório: ligar a publicação continua sendo um ato da pessoa no host.
- **As imagens em si.** Esta mudança publica o site e as páginas; as capturas de tela saem do outro pedido (as imagens da documentação, tiradas de um espaço de trabalho fictício de dentro do próprio aplicativo e refeitas a cada versão). Enquanto ele não chega, valem o texto e os espaços reservados da regra 8.
- **O gerador alternativo sem toolchain.** Jekyll não é construído, nem um caminho de dois geradores.
- **Mover a documentação de referência para dentro do site.** `docs/` fica onde está.
- **Publicar qualquer coisa além do site.** Nada de pacote, artefato de versão ou dado do aplicativo entra na publicação.
- **Traduzir a documentação que hoje é só em inglês.** O site mostra todas as páginas nas duas línguas, como as páginas de hoje fazem (a maioria traz as duas seções no mesmo arquivo); uma página que só exista em inglês não ganha tradução nova por esta mudança.
- **A página de capturas planejadas do repositório.** Ela continua sendo a lista de pendências das imagens; não vira página do site.

## Aceitação

Cada item é algo que a pessoa confere. Onde a conferência depende de um passo que só existe quando a mudança está no host, ele está dito.

**No pedido de merge, antes de mesclar:**

1. **O que a mudança acrescenta ao repositório está lá e passa nos portões.** O pedido de merge traz o site, o fluxo de publicação e a checagem do site; a auditoria pública, a checagem de tipos e a suíte de testes passam. *(Verificável no pedido de merge e no resultado da integração contínua.)*
2. **O site constrói, os links resolvem e as duas línguas têm todas as páginas.** A checagem do site passa no mesmo resultado de integração contínua que os outros portões. *(Verificável no resultado da integração contínua.)*
3. **A abertura, o guia, a referência, os casos de uso, o blog e a página do histórico existem nas duas línguas.** Abrindo a prévia local do site, cada seção tem a página em inglês e a página em português correspondente. *(Verificável na prévia local; nesta etapa não foi exercitado.)*
4. **Cada página da documentação de referência de hoje é alcançável a partir do site.** Abrindo a referência na prévia, cada documento listado leva a uma página do site que existe. *(Verificável na prévia local; nesta etapa não foi exercitado.)*
5. **A página do histórico segue o arquivo.** Uma mudança feita no histórico de mudanças aparece na página depois de reconstruir o site, e não há uma segunda cópia do histórico versionada com o site. *(Verificável lendo a árvore e reconstruindo.)*
6. **O blog abre com o texto da versão estável publicada, escrito a partir do histórico.** O texto da versão publicada mais recente está publicado, e o que ele conta sai da seção daquela versão no histórico de mudanças. *(Verificável na prévia local.)*
7. **O site não usa imagem real nenhuma.** Abrindo as páginas, o que pede imagem mostra texto e espaço reservado; nenhuma captura traz tela, nome, endereço ou atividade de pessoa real. *(Verificável na prévia local.)*
8. **A publicação do site está declarada e o aplicativo não mexeu em configuração de repositório.** O fluxo que publica está no repositório, na branch padrão, e nenhum arquivo da mudança escreve configuração de publicação no host. *(Verificável lendo a árvore.)*
9. **A linha de status dos dois README diz a versão atual e leva ao site.** Abrindo cada README, a linha de status não diz mais a versão de estreia e o link do site está ali. *(Verificável lendo os dois arquivos.)*

**Depois que a pessoa liga a publicação e mescla:**

10. **O site responde no endereço do projeto dentro da execução do fluxo.** A pessoa liga a publicação uma vez na configuração do repositório, mescla, e o site abre no endereço publicado quando o fluxo termina. *(Só verificável no host, depois da mesclagem; nesta etapa não foi exercitado.)*
11. **O site publicado é conferido pela própria pessoa, de dentro do aplicativo.** Um agente com o endereço publicado entre os hosts permitidos abre o site no navegador do aplicativo e guarda uma captura como comprovação; a captura mostra a abertura publicada. *(Só verificável com o site no ar; nesta etapa não foi exercitado.)*
12. **Uma mudança posterior na documentação de referência ou no histórico atualiza o site na mesclagem, sem passo novo.** Alterar um documento de referência e mesclá-lo faz o site publicado mostrar a alteração depois que o fluxo daquela mesclagem roda; nenhuma ação além do "sim" de sempre é pedida. *(Só verificável depois da publicação ligada; nesta etapa não foi exercitado.)*
13. **A checagem do site pega as duas falhas que ela existe para pegar.** Um link que aponta para uma página que não existe e uma página que existe só numa das línguas reprovam a checagem do site. *(Verificável provocando cada falha e rodando a checagem; nesta etapa não foi exercitado.)*
14. **O agente de documentação trabalha a pasta do site pelo ciclo normal.** A mudança do site chega por um agente do time com sandbox, num fluxo de documentação com gate e com o "sim" antes da publicação, do mesmo jeito que qualquer outra mudança. *(Verificável acompanhando a primeira mudança do site pelo ciclo; nesta etapa não foi exercitado.)*

## O que esta etapa verificou

Foi lido, não executado. A conferência contra a árvore de trabalho, nesta etapa:

- **Sem fluxo de publicação e sem pasta de site.** Os fluxos de integração contínua que existem são os dois que a triagem registrou (o de verificação e o de release); nenhum publica um site, e não há pasta de site no repositório. A construção do site, os links e as línguas **não têm hoje nenhuma checagem** no fluxo de verificação, então as regras 2, 3, 4, 6, 9, 10, 11, 12 e 13 são comportamento novo.
- **A documentação de referência é uma pasta de arquivos por assunto**, com o índice listando três seções e a língua de cada página; parte é bilíngue no mesmo arquivo. É de onde a seção de referência do site é incluída (regra 1), e a regra 5 vai exigir uma travessia dessa pasta que ainda não existe.
- **A linha de status dos dois README** diz a versão de estreia, e nenhum dos dois leva a um site, porque não há site: a regra 12 muda os dois arquivos.
- **O histórico de mudanças** é prosa por versão, com uma seção sem versão vazia no topo e uma seção por versão; a ferramenta que o repositório já usa para publicar a nota de uma versão extrai exatamente a seção da versão pedida. É o material da página do histórico (regra 6) e do texto do blog (regra 7): o mesmo extrator serve aos dois, e a versão estável publicada já tem a sua seção.
- **O agente do fluxo de documentação de hoje** escreve só o arquivo de instruções da raiz, não roda comando e não lê o rastreador, e o fluxo de documentação é o do repositório, não o de uma pasta de squad. A regra 14 descreve um agente da pessoa com sandbox encaminhado à pasta do site, que é uma configuração que ainda não existe.
- **Duas coisas que o plano vai ter de encarar, e que foram conferidas no código.** A primeira: o agente que escreve só pode gravar dentro da pasta de trabalho da execução (é a cerca das ferramentas de arquivo), então uma captura em imagem que o site fosse referenciar precisa chegar ao repositório por um caminho que passe por essa cerca — e sem capturas do outro pedido, a regra 8 mantém a página em texto e espaço reservado. A segunda: o **texto de cada bloco** de uma página de documentação é o arquivo do repositório, então uma página de referência do site não pode ser um arquivo diferente do mesmo documento com outro texto; a inclusão da regra 1 é o que impede isso. **A forma técnica de incluir (montagem, ligação, qualquer mecanismo equivalente) é do plano**, não desta spec.
- **A auditoria pública varre a árvore toda** (arquivos versionados e não ignorados), lê cada linha de texto e não lê o conteúdo de uma imagem; o repositório não ignora pasta de site alguma. É o que sustenta a regra 9 para as fontes do site, e é por isso que as páginas entram na varredura sem uma exceção nova.
- **O aplicativo não tem escrita de configuração de Pages nem de repositório:** as ocorrências da palavra são constantes de paginação de conversa com o provedor de código. A regra 2 descreve exatamente isso.

**Não verificado nesta etapa:** nada foi executado. Não houve construção de site, checagem de links, checagem de línguas, prévia local, abertura de página nem publicação; nem se tocou no host. Todo item de aceitação acima está marcado com onde ele se verifica, e nenhum foi exercitado.

## Perguntas em aberto

Nenhuma pergunta bloqueia o plano. A única escolha que fica com ele está dita na seção **O que o refino decidiu**: o agente exato, o fluxo e o encaminhamento à pasta do site, com a recomendação já registrada. Domínio próprio fica fora do escopo e, se voltar, é decisão da pessoa, com custo e termos.

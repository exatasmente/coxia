# O site de documentação junta landing, guia, referência, casos de uso e blog no GitHub Pages

## Tipo

Pedido de funcionalidade. Não relata defeito, não é pergunta e não repete outra issue: pede que o repositório publique um site de documentação no GitHub Pages com uma landing, um guia (instalar, primeiro workspace, primeira cerimônia, primeira execução), a documentação de referência já em `docs/`, casos de uso e um blog cujos primeiros textos saem das notas de release, escrito e mantido pelos agentes do aplicativo pelo ciclo normal.

## Dá para entender como está escrita

Dá para entender como está escrita. O comportamento pedido tem forma de comportamento (onde o site fica, por que workflow é publicado, como é bilíngue, quais seções existem, de onde vêm as imagens, o que a auditoria pública e o CI passam a conferir) e uma seção de aceitação com oito condições verificáveis. Nada aqui foi executado: a conferência foi só de leitura, contra a árvore do repositório.

O que foi conferido por leitura, e que a issue descreve como o estado de hoje:

- `docs/` traz a documentação de referência e um índice com três seções e as línguas de cada página, e é bilíngue em parte: cada documento numerado carrega pt-BR e en na mesma página, e o que sobra é só em inglês. `docs/images/` guarda um único arquivo, a página de capturas planejadas, e ela é uma lista de pendências. O README da raiz não tem imagem alguma: traz uma tabela com um comentário de tarefa a fazer apontando para essa página de pendências.
- O README da raiz diz, em destaque, "Status: 0.1, first public version" (e o README em português diz o mesmo), enquanto a versão instalada é 0.9.0-beta.15. A linha de status está atrás de várias versões.
- `CHANGELOG.md` é prosa por funcionalidade, sob uma seção sem versão (vazia) e depois uma seção por versão com subtítulos de adicionado, alterado e corrigido. É o material de onde sairiam o blog e os casos de uso.
- O tipo de execução de documentação existe e o agente que escreve nele só pode escrever o arquivo de instruções da raiz: sem shell e sem rastreador. Nenhum estágio declara hoje que quer uma tela virtual, então nada nele tira capturas. O site precisaria de um agente da pessoa, com sandbox, encaminhado à pasta do site.
- Nada no aplicativo escreve configuração de Pages nem de repositório: as únicas ocorrências da palavra são constantes de paginação de conversa com o provedor de código. Ligar o Pages é mesmo um ato na configuração do repositório, no host.
- O repositório tem hoje dois fluxos de integração contínua, um de verificação e um de release; não há nenhum fluxo de Pages.
- A auditoria pública varre os arquivos rastreados e os não ignorados, confere cada linha de texto e o caminho dos binários, e não lê o conteúdo de uma imagem. O repositório não ignora nenhuma pasta de site, então uma pasta `site/` entraria na varredura como está.
- A ferramenta de build que o pedido cita (VitePress) casa com o que o repositório já usa: Vite e electron-vite estão entre as dependências de desenvolvimento, junto de vitest e typescript.

## O que falta

Nada aqui depende de quem abriu a issue: o comportamento, a aceitação e as dúvidas de refino estão respondidos no próprio texto. O que segue são dúvidas que o refino resolve, não a triagem, porque nenhuma delas impede entender o pedido:

- A escolha do gerador entre o de toolchain (VitePress) e o sem toolchain (Jekyll), que a issue deixa em aberto.
- Se a pasta do site é `site/` e como o agente de documentação é encaminhado a ela pela configuração de squad.
- Se a referência é incluída de `docs/` (preferência declarada da issue) ou movida para dentro do site. Incluir preserva os documentos que os agentes leem em tempo de execução.
- Domínio próprio agora ou nunca: tem custo e termos, e cai na regra de efeito externo como decisão separada.
- O que o site mostra enquanto as imagens não existirem: até o trabalho de capturas chegar, o próprio pedido manda usar texto e espaços reservados.

## Issues relacionadas

- #221 (as imagens da documentação saem de um workspace semeado com dados fictícios, e o release as refaz): a issue diz que o site usa a tela virtual e os scripts de captura dessa issue, e que até ela chegar o site usa texto e espaços reservados. É pré-requisito e complemento, não duplicata: #220 publica o site, #221 entrega as imagens. A pasta dessa issue não está nesta árvore, então ela foi considerada pela citação da própria #220 e pelo registro do workspace, não por releitura aqui (não verificado nesta árvore).
- #213 (pool de modelos por atividade): relacionada de forma fraca. A pasta desta árvore mostra que o rastreador não mantém pasta para toda issue; então uma varredura de duplicatas sobre todas as issues não é possível a partir da árvore. Nenhuma outra issue com o mesmo pedido de site foi encontrada nas pastas presentes.
- As páginas que já prometem capturas (a página de capturas planejadas e os dois READMEs) não são uma issue, mas ficam dependentes da #221, não desta.

## Squad

`Plataforma`. O que o pedido mexe é o runtime e a infraestrutura do repositório: um novo fluxo de integração contínua, a pasta de site no mesmo git, o agente com sandbox encaminhado por squad, a auditoria do repositório e a checagem de CI. Nada aqui é tela do aplicativo nem texto de interface (o site não passa pela regra de `t()` da interface do desktop).

## Prioridade sugerida

`priority:medium`, como sugestão a quem decide. A falta do site não quebra nenhuma instalação: hoje há índice e README. Mas o pedido é grande (gerador, seis seções em duas línguas, workflow, checagem de CI, blog por release, mudança da linha de status) e a documentação pública atual está desatualizada e espalhada, o que pesa mais que uma melhoria pequena. Não é `high` porque nada está defeituoso nem bloqueado.

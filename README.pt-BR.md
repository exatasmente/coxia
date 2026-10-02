# Coxia

Português (Brasil) | [English](README.md)

**Chegue à daily já preparado e saia com os encaminhamentos feitos.** O Coxia é um app de desktop (com companheiro no celular) que conduz o desenvolvedor pelos rituais recorrentes do time, por voz ou por texto: um agente de IA por atividade aberta lê o repositório, as specs e a documentação que você indicar antes de falar, ajuda a destravar o que está parado e entrega a ata. Nada muda fora da sua máquina sem o seu "sim" explícito.

> **Status: 0.1, primeira versão pública.** O autor usa todo dia, mas partes só foram verificadas contra servidores de teste (veja [O que foi verificado](#o-que-foi-verificado)). Espere arestas e leia as notas honestas abaixo.

<!-- TODO(capturas de tela): tirar com dados de demonstração (um repositório descartável e atividades fictícias), nunca com dados reais de empresa ou de pessoas. Veja docs/images/README.md. -->

| Captura (TODO) | O que mostra |
|---|---|
| `docs/images/today.png` | A tela Hoje: cartões das atividades abertas com a etapa de cada uma |
| `docs/images/call.png` | Uma cerimônia em andamento, por voz ou texto, com as fontes do agente |
| `docs/images/actions.png` | A fila de ações: o comando exato, esperando a sua confirmação |
| `docs/images/wizard.png` | O assistente de configuração da primeira execução |
| `docs/images/phone.png` | O companheiro no celular (PWA) |

## Sumário

- [O que faz](#o-que-faz)
- [Como funciona](#como-funciona)
- [Primeiros passos](#primeiros-passos)
- [Provedores de modelo](#provedores-de-modelo)
- [Hospedagens de código e escopos de token](#hospedagens-de-código-e-escopos-de-token)
- [Privacidade: o que sai da sua máquina](#privacidade-o-que-sai-da-sua-máquina)
- [Modelo de segurança](#modelo-de-segurança)
- [O que foi verificado](#o-que-foi-verificado)
- [Documentação](#documentação)
- [Roadmap](#roadmap)
- [Contribuir](#contribuir)
- [Licença e marcas](#licença-e-marcas)

## O que faz

- **Pré-daily.** Antes da daily, um agente por atividade aberta confere a issue, os merge ou pull requests, o pipeline, as discussões de revisão e a spec, e diz o que mudou e o que está parado. Você responde por voz ou texto; o app produz a ata.
- **Desbloqueio e aprofundamento.** Converse sobre um problema com um agente que já leu o código, as specs e as regras do time, e que consulta a hospedagem de código. É somente leitura: explica e propõe, não edita o seu repositório.
- **Gate (quiz).** Antes de uma atividade avançar, um quiz curto gerado a partir da spec confere se você entende o que vai entregar.
- **Passagem para o QA.** Prepara um checklist a partir da spec e da mudança, pronto para quem vai testar.
- **Retro.** Reúne o que aconteceu no período a partir dos seus próprios registros.
- **Conflitos de release.** Quando uma branch conflita com a release, um agente propõe a resolução trecho a trecho; você revisa e só então algo é gravado.
- **Tempo por issue.** O tempo medido nas cerimônias, pronto para copiar para um controle de horas.
- **Seu processo, não o nosso.** As cerimônias, o vocabulário de etapas e os documentos que os agentes procuram vêm de um *modelo de ciclo de desenvolvimento*: SDD com gates, Scrum, Kanban, GitHub Flow ou Mínimo, todos editáveis e exportáveis.
- **Voz é opcional.** Tudo funciona por texto. Ligada a voz, ouvir é local (Whisper) e falar é Edge TTS (nuvem) ou Kokoro (local).
- **Companheiro no celular.** Um PWA pareado por QR code, com notificações push e fila offline.
- **Dois idiomas.** A interface e os prompts dos agentes existem em português do Brasil e em inglês, com temas claro e escuro.

## Como funciona

### Agentes

Cada atividade abre o seu agente. Antes de falar, ele lê o que você configurou como contexto: arquivos `CLAUDE.md`, skills, definições de agentes, regras e bases de conhecimento, servidores MCP e a pasta de specs da atividade. Trabalha nas pastas dos seus projetos e não sai delas. A resposta é um resultado estruturado que as telas mostram e que você pode aceitar, editar ou descartar.

### Dois motores

| Motor | Roda sobre | Provedores |
|---|---|---|
| **Claude** | O Claude Agent SDK (o runtime do Claude Code) | API da Anthropic, Amazon Bedrock, Google Vertex AI, Microsoft Foundry (modelos Claude) |
| **Aberto** | Laço de agente próprio do Coxia sobre o OpenAI Chat Completions | Qualquer servidor compatível com OpenAI: Ollama, LM Studio, llama.cpp, vLLM, OpenAI, Groq, DeepSeek, OpenRouter (modelos que não são Claude) e similares |

O Claude Agent SDK é proprietário e **não vai** nos pacotes públicos: o assistente de configuração mostra os termos da Anthropic e o instala numa pasta sua na primeira vez. Os dois motores aplicam a mesma política de segurança às ferramentas. Detalhes: [`docs/llm-providers.md`](docs/llm-providers.md).

### Segurança em um parágrafo

Os agentes só leem. Tudo o que tem efeito fora do app (comentário, label, push, atualização de merge request, nota no plano) vira uma *ação proposta* que mostra o comando exato; só roda depois que você confirma, e toda ação executada fica num registro de auditoria. Um workspace pode ser marcado como "de testes", e então todo efeito externo é recusado. Mais em [Modelo de segurança](#modelo-de-segurança).

## Primeiros passos

### Baixar (Linux)

1. Abra a [página de Releases](https://github.com/exatasmente/coxia/releases) e baixe o `.AppImage` (qualquer distribuição; precisa de `libfuse2`) ou o `.deb` (Debian e Ubuntu).
2. `chmod +x` no AppImage e execute, ou `sudo apt install ./<arquivo>.deb`.
3. Siga o assistente da primeira execução: idioma e nome, modelos, Claude Agent SDK (só se usar modelos Claude), projetos, hospedagem de código, a documentação que os agentes leem, ciclo de desenvolvimento e voz (opcional).

> Os arquivos de release se chamam `coxia-<versão>.AppImage` e `coxia_<versão>_amd64.deb`. O executável instalado, as pastas de dados (`~/.local/share/cerimonias`) e a entrada do menu mantêm o nome original `cerimonias`, então uma instalação de uma versão anterior é substituída no lugar e mantém os dados. Os AppImages se atualizam sozinhos pelo GitHub Releases ([`docs/updates.md`](docs/updates.md)); o `.deb` é atualizado pelo gerenciador de pacotes. Há builds para Windows e macOS preparados, mas sem assinatura e sem testes: trate como experimentais.

### A partir do código-fonte

Requisitos: a versão do Node.js do [`.nvmrc`](.nvmrc) e, só se quiser voz, Python 3 e [uv](https://docs.astral.sh/uv/).

```bash
nvm use                     # a versão do .nvmrc
npm ci
npm run dev                 # desenvolvimento, com recarga automática
# ou um build de produção: npm run build && npx electron .
```

Voz opcional a partir do código:

```bash
uv venv --python 3.12 sidecar/.venv
uv pip install --python sidecar/.venv/bin/python -r sidecar/requirements.txt
```

No app empacotado isso é feito em Configurações, Voz. Para gerar os mesmos pacotes das releases: `npm run dist:public` (veja [`RELEASING.md`](RELEASING.md)). O resto sobre desenvolvimento está em [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Provedores de modelo

| Provedor | Motor | Notas |
|---|---|---|
| API da Anthropic | Claude | Chave de API. O padrão de uma instalação nova. |
| Amazon Bedrock, Google Vertex AI, Microsoft Foundry | Claude | Credenciais da sua nuvem. Escrito a partir da documentação da Anthropic; não testado com conta real. |
| Ollama, LM Studio, llama.cpp, vLLM | Aberto | Local ou próprio. Veja os requisitos abaixo. |
| OpenAI, Groq, DeepSeek, OpenRouter (modelos que não são Claude) | Aberto | Qualquer endpoint compatível com OpenAI, com chave de API. |

Notas honestas:

- **Login de assinatura do claude.ai não é oferecido.** Use uma chave de API ou as credenciais da sua nuvem.
- **Modelos locais e pequenos precisam de duas coisas:** *tool calling* de verdade e uma janela de contexto de **pelo menos 10 mil tokens** (16 mil ou mais é confortável). O prompt do agente (regras, skills, definições de ferramentas) já passa de 10 mil tokens. O Ollama vem com 4096: aumente o `num_ctx`. Modelos de poucos bilhões de parâmetros erram argumentos de ferramentas com frequência; use o teste de conexão do assistente e prefira modelos treinados para ferramentas.
- **O motor aberto só foi testado contra um servidor falso roteirizado**, ainda não contra um Ollama ou modelo hospedado de verdade. Conte o que encontrar.
- Os dois motores mantêm sessões separadas, e o motor aberto não calcula custo em dólar, só tokens.

Tabela do que foi testado e as limitações conhecidas: [`docs/llm-providers.md`](docs/llm-providers.md).

## Hospedagens de código e escopos de token

GitLab (gitlab.com e auto-hospedado), GitHub (github.com e Enterprise Server) e Bitbucket Cloud, atrás de uma interface neutra. A hospedagem é opcional: sem ela, o Coxia continua funcionando a partir dos seus repositórios e documentos locais.

O app **lê** por padrão. Escritas só acontecem depois de uma proposta confirmada e pedem mais permissão:

| Hospedagem | Leitura | Escrita (depois da sua confirmação) |
|---|---|---|
| GitLab | `read_api` | `api` |
| GitHub, token clássico | `repo` | `repo` |
| GitHub, token de granularidade fina | Metadata, Contents, Issues, Pull requests e Actions: somente leitura | Issues e Pull requests: leitura e escrita |
| Bitbucket Cloud | `account`, `repository`, `pullrequest`, `issue` | `pullrequest:write`, `issue:write` |

Comece pelo escopo de leitura; acrescente escrita só se quiser que o app proponha e execute ações. Também dá para usar o login da CLI da hospedagem (`glab` ou `gh`) no lugar de um token. Detalhes: [`docs/vcs-providers.md`](docs/vcs-providers.md).

## Privacidade: o que sai da sua máquina

O Coxia não tem sistema de contas, nem análise de uso, nem servidor próprio. O que pode sair da sua máquina:

| O quê | Para onde | Quando |
|---|---|---|
| Prompts, os arquivos e a saída de comandos que o agente lê, e as suas mensagens | O provedor de modelo que você escolheu (Anthropic, sua nuvem, OpenAI, OpenRouter, ...), ou **lugar nenhum** com um modelo local | A cada chamada de agente |
| Pedidos de issues, merge requests, comentários, pipelines | A hospedagem de código configurada (GitLab, GitHub, Bitbucket) | Quando há hospedagem configurada |
| O texto a ser falado | O serviço de voz online da Microsoft | Só se o motor Edge TTS estiver ligado. Com o Kokoro (local) nada sai. |
| O que o próprio Claude Agent SDK reportar | A Anthropic, conforme as [políticas da Anthropic](https://code.claude.com/docs/en/legal-and-compliance) | Só se usar o motor Claude e instalar o SDK. O Coxia não adiciona telemetria própria. |
| Verificação de atualização | GitHub Releases (o repositório do projeto) | Só em AppImages publicados; dá para desligar em Configurações, Atualizações |
| Downloads da instalação da voz | PyPI e Hugging Face (e os arquivos do modelo Kokoro, se você os escolher) | Só quando você liga a voz |

Mais nada. O reconhecimento de fala é sempre local. Segredos (chaves de API, tokens) ficam criptografados no chaveiro do sistema operacional (`safeStorage` do Electron); onde não há chaveiro o app se recusa a guardá-los, a menos que você aceite explicitamente um arquivo inseguro. Nunca vão para uma exportação de configuração. Suas atas, histórico e registro de auditoria ficam na pasta de dados do app, no seu disco.

## Modelo de segurança

- **Agentes somente leitura.** As ferramentas são `Read`, `Grep`, `Glob`, um `Bash` com lista de permissão, `Skill`, um subagente somente leitura e as ferramentas MCP que você permitir. Sem `Edit`, sem `Write`, sem busca ou download da web.
- **Listas de permissão.** Comandos de shell são comparados com padrões estritos (um comando, sem `;`, `&&` ou pipes além de `head`); o motor aberto executa comandos sem shell nenhum. As CLIs das hospedagens ficam restritas a endpoints de leitura (`glab api` e `gh api` sem flags de escrita).
- **Arquivos de segredo fora de alcance.** Arquivos `.env`, chaves, `~/.ssh`, `.mcp.json` e qualquer nome que lembre segredo ou credencial são bloqueados antes da leitura e durante a busca, e os resultados das ferramentas são redigidos.
- **Confirmação para toda escrita.** Efeitos externos são propostas com o comando literal, validadas contra um formato por provedor antes de serem guardadas e de novo antes de rodar. Um único caminho de código os executa.
- **Registro de auditoria.** Toda ação executada é acrescentada a `auditoria.jsonl` no workspace, com o corpo e sem o token.
- **Workspaces de testes.** A marca de testes mantém todo efeito na máquina.
- **Companheiro no celular (PWA).** Desligado por padrão e preso ao loopback. O pareamento usa um código descartável de curta duração (12 caracteres, válido por 10 minutos) mostrado no desktop; as sessões são presas ao aparelho, expiram, e tentativas erradas têm limite de taxa. Tudo o que muda a máquina (configuração, arquivos, atualizações, instalação de software, segredos) é só do desktop, e aprovar efeitos externos pelo celular fica desligado até você ligar.
- **Atualizações.** Só feed HTTPS, sha512 conferido no AppImage baixado, sem rebaixar versão, instalação só por decisão sua. No Linux o AppImage não é assinado: a confiança vem do processo de release do repositório.

Para reportar uma vulnerabilidade, veja [`SECURITY.md`](SECURITY.md).

## O que foi verificado

Dito sem rodeios, para você avaliar o risco:

- A suíte de testes cobre os motores, as políticas, os provedores e a lógica das telas contra servidores falsos. Não chama modelos reais.
- O suporte a GitHub e Bitbucket foi testado contra servidores falsos modelados na documentação. **Escritas** em qualquer hospedagem não rodaram contra uma hospedagem real; leituras no GitLab são o único uso real até agora.
- Bedrock, Vertex e Foundry, modelos locais, macOS e Windows não foram testados.

## Documentação

Índice: [`docs/README.md`](docs/README.md). Os principais: [configuração](docs/configuration.md), [provedores de modelo](docs/llm-providers.md), [hospedagens de código](docs/vcs-providers.md), [ciclos de desenvolvimento](docs/cycles.md), [voz](docs/voice.md), [atualizações](docs/updates.md) e [releases](RELEASING.md). Boa parte dos documentos tem seção em português e em inglês; os demais estão em inglês.

## Roadmap

Intenções, não promessas:

- Experimentar o motor aberto com modelos locais de verdade e publicar quais funcionam bem.
- Exercitar as escritas de GitHub e Bitbucket em contas reais; campos de quadro do GitHub Projects no mapeamento de etapas do ciclo.
- Mais textos da interface e prompts revisados em inglês; traduções contribuídas.
- Builds de Windows e macOS assinados e uma história de assinatura verificada para Linux.
- Tela de custo e uso neutra quanto ao provedor (hoje ela lê os endpoints do OpenRouter).
- Um jeito mais amigável de compartilhar e descobrir modelos de ciclo.

## Contribuir

Issues e pull requests são bem-vindos. Leia [`CONTRIBUTING.md`](CONTRIBUTING.md) e o [Código de Conduta](CODE_OF_CONDUCT.md); como o projeto é conduzido está em [`GOVERNANCE.md`](GOVERNANCE.md). Os documentos de contribuição estão em inglês.

## Licença e marcas

O Coxia é licenciado sob a [Apache License 2.0](LICENSE). Copyright 2026 Luiz Neto. Componentes de terceiros e suas licenças: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) e [`NOTICE`](NOTICE).

O Coxia é um projeto independente e **não é afiliado, endossado nem patrocinado pela Anthropic**. "Claude" e "Claude Code" são marcas da Anthropic, PBC. O Coxia pode executar modelos Claude por meio do Claude Agent SDK, que você mesmo instala sob os termos da Anthropic. GitHub, GitLab, Bitbucket, Microsoft, OpenAI e os demais nomes de produtos citados pertencem aos seus donos e são usados apenas para dizer com o que o Coxia funciona.

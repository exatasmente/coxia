# O que os textos mudados dizem bate com o que o motor faz

## Veredito

Aprovado. O diff muda apenas textos que uma pessoa lê — dois catálogos de interface, a página de provedores nas duas línguas, as duas notas honestas do README, uma linha do CHANGELOG e uma entrada da lista de diferenças admitidas do teste de catálogos. Nenhuma linha de comportamento foi tocada.

## O que foi conferido

Conferido lendo o diff e os arquivos inteiros, e rodando os comandos que a etapa permite:

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | passou, exit 0, sem saída |
| `npm run i18n:lint` | passou, exit 0: 4054 chaves nas duas línguas, 0 literais |
| `node scripts/public-audit.mjs` | passou, exit 0: 910 arquivos, nada de empresa ou pessoa |
| `node scripts/theme-audit.mjs` | passou, exit 0: 55 pares de contraste, 8 cores literais no arquivo `api.ts`, número de antes |
| `npx vitest run` dos quatro testes de catálogo | passou: 4 arquivos, 23 testes |
| `npx vitest run` (suíte inteira) | 215 arquivos passaram, 7 falharam; 20 testes vermelhos, todos por estouro de tempo (ver abaixo) |

## O que mudou, arquivo a arquivo

- **`src/shared/i18n/wizard.en.json` e `wizard.pt-BR.json`.** A chave `wizard.models.openEngineNote` deixou de dizer "read-only tools"/"ferramentas só de leitura" e diz que o provedor roda no motor aberto (o loop de agente do app), que ele lê, escreve dentro do worktree da execução e roda comandos sob a mesma política de segurança do Claude Agent SDK, e que a qualidade depende do modelo. A chave é a mesma, sem parâmetro novo, e os dois idiomas dizem o mesmo. O componente que mostra a nota não mudou.
- **`docs/llm-providers.md`.** A passagem de escolha do motor deixou de chamar as variáveis de ambiente de "a seleção" e de prometer "a camada de configuração"; agora diz que cada provedor de `llm.providers` carrega o motor e cada papel aponta provedor e modelo, e que as variáveis são só recurso de teste. "O que a camada de configuração precisa entregar" virou "o que a seleção entrega". O padrão de fontes de contexto deixou de ser atribuído ao gancho de teste. A linha das limitações conhecidas deixou de dizer que as ferramentas são só de leitura e descreve leitura, escrita confinada ao worktree, comandos da lista e ferramentas MCP permitidas, sem rede. Mesma frase nas duas línguas. A tabela de cobertura e o texto ao redor **não** mudaram.
- **`README.md` e `README.pt-BR.md`.** A nota honesta deixou de dizer que o motor aberto só foi testado contra um servidor falso: agora diz que ele rodou contra um modelo de verdade em quatro execuções, no runner e contra um host de código falso, e que nenhum provedor local foi testado.
- **`test/gitlab-catalogs-unchanged.test.ts`.** Uma entrada em `INTENDED` para `wizard.models.openEngineNote`, com motivo maior que vinte caracteres e `language: 'both'`, sem `replace`. A fixture `test/fixtures/catalogs-main/wizard.*.json` continua com o texto antigo, intacta.
- **`CHANGELOG.md`.** Uma linha em `## [Unreleased]`, seção Changed, no formato do arquivo, sem prefixo de tipo e sem número.

## Frases velhas

A busca pelas frases que o pedido manda corrigir não encontrou nenhuma sobra nos arquivos mudados: "ferramentas só de leitura"/"read-only tools", "a camada de configuração vai trocar"/"the configuration layer will replace", "por enquanto a seleção"/"For now selection" e "só foi testado contra um servidor falso…" não aparecem em `docs/llm-providers.md` nem no README. As ocorrências que restam estão fora do escopo declarado e não escondem nada: a cópia congelada da fixture (que é o texto do `main` de propósito), a seção histórica `[0.1.0]` do CHANGELOG (texto de uma versão publicada, que não se reescreve) e a frase equivalente que o plano deixou de fora em `docs/configuration.md` e no comentário de `bridge.ts`.

## A suíte inteira

Rodada de uma vez, 7 arquivos ficaram vermelhos: `conflict-resolve`, `release-git`, `runner-chain`, `updates-source`, `update-script`, `runner-release` e `conflict-policy`. Os 20 testes vermelhos são todos estouro de tempo (5 s, 30 s, 60 s, um hook de 10 s) em arquivos que mexem com git e com o catálogo de update; nenhum é de catálogo, de i18n ou de documentação. É mais do que os quatro arquivos que a implementação tinha visto, o que reforça a leitura de sobrecarga da máquina ao rodar 222 arquivos em paralelo. **Não verificado**: não foi medido se esses arquivos também falham nesta máquina com o repositório sem esta mudança — repetir a suíte com o diff revertido passaria do orçamento de comandos desta etapa. Nada no diff toca esses arquivos nem o comportamento que eles exercitam.

## O que ficou fora desta revisão

- O comportamento do motor aberto em si: só foram lidos os textos; nenhuma execução com modelo real, nenhuma tela aberta. A afirmação da nota nova sobre escrita no worktree e comandos sob a mesma política foi conferida contra o que a própria página de provedores e o plano descrevem, não por execução.
- A fixture congelada foi lida e comparada, mas a suíte completa que a exercita não passou inteira nesta etapa (pelos estouros acima); o teste de catálogos rodado sozinho passou.

## Achados

Nenhum achado bloqueante. Duas observações de baixa relevância, já cobertas pelo plano e sem ação nesta mudança:

1. A frase equivalente sobre a "camada de configuração" continua em `docs/configuration.md` e no comentário de topo de `src/main/engine/open/bridge.ts`. É a mesma afirmação desatualizada, mas está fora dos textos que a issue nomeia; o plano a registra como linha de trabalho própria.
2. O texto novo da nota é mais longo que o antigo (duas frases em vez de uma). Continua curto e cabe no mesmo parágrafo pequeno do formulário; nada na tela mudou de estrutura.

# Revisão: arquivos na conversa e os agentes abrindo o que foi enviado

## Veredito

**Aprovado.** Os dois bloqueantes da rodada anterior foram fechados nesta passada, com cobertura de teste, e nenhum bloqueante novo aparece no que esta rodada mudou.

O bloqueante 1 (o portão de tipos vermelho) está resolvido: o teste `runner-answer-attachments` deixou de montar a configuração à mão e passou a partir da configuração existente, trocando só a opção do espaço de trabalho; `npx tsc --noEmit` sai com código 0.

O bloqueante 2 (a mensagem `answer` do runner sem âncora, e por isso os dois canais de arquivo a recusando) está resolvido: `moveRun` (`src/main/runs-forum.ts`) põe em toda mensagem que grava a mesma âncora que o módulo do fórum põe numa mensagem escrita (`threadAnchor(runThreadId(id))`), preservando a que a mensagem já traga. O teste novo `test/runner-answer-attachment-open.test.ts` sobe dois arquivos reais na conversa da execução, grava a resposta como o runner a grava e confirma, pelos próprios canais do módulo, que os bytes dos dois são servidos por `forum:attachment-get` na mensagem `answer` e que `forum:attachment-delete` remove os dois arquivos do disco — e que a mesma mensagem nunca é aberta por outra conversa.

A sugestão não bloqueante herdada das rodadas anteriores (juntar os pedaços de imagem do motor aberto numa única mensagem de usuário por rodada) segue **não feita** e continua sendo sugestão, não bloqueante: ela já era uma sugestão, e nada novo no diff desta rodada a transforma em defeito.

## O que foi verificado nesta revisão

Todos os portões desta passada foram rodados direto:

- **Typecheck** (`npx tsc --noEmit`): **limpo**, código de saída 0. O erro de tipos da rodada anterior não aparece.
- **public-audit** (`node scripts/public-audit.mjs`): limpo, 927 arquivos, nada de empresa, host ou pessoa.
- **i18n:lint** (`npm run i18n:lint`): limpo, 4127 chaves nos dois idiomas, 11 catálogos.
- **theme-audit** (`node scripts/theme-audit.mjs`): limpo, 55 pares de contraste acima de 4.5:1, sem cor literal nova além das 8 já existentes em `api.ts`.
- **Build do CI** (`npx electron-vite build`): construído, código de saída 0.
- **Suíte completa** (`npx vitest run`): **inteira verde nesta passada** — 233 arquivos, 3734 testes, nenhuma falha. Numa execução anterior da mesma suíte, 7 testes de 6 arquivos estouraram o limite de 5 s por teste sob a carga de 233 processos; reexecutados isoladamente (por exemplo `sandbox-hardening` e `voice-setup`, 50 testes), passam, e nenhum deles toca o recurso de anexos. O vermelho era do tempo sob carga paralela, não do diff.
- **Testes do recurso, exercitados nesta revisão**: `runner-answer-attachment-open` (1), `runner-answer-attachments` (3), `forum-attachment-delete` (4), `forum-attachments` (7), `attachments-tool` (7) e `attachments-store` (6) — 35 testes, todos verdes. Os dois caminhos que a rodada anterior apontou (a mensagem `answer` abrindo os próprios arquivos e a exclusão apagando-os do disco) estão cobertos e verdes.

O que **não foi verificado** nesta revisão, e não pode ser dado como feito:

- a tela rodando (miniatura, cartão, arrastar-e-soltar, colar, seletor do telefone, e o botão de apagar com a confirmação);
- o envio de um arquivo perto do limite pelo corpo de 15 MB do RPC, com um aparelho pareado real;
- um provedor compatível real aceitando o pedaço de imagem no histórico do motor aberto;
- a leitura da imagem pelos dois motores produzindo a resposta que o aceite descreve (o motor fechado tem só o teste de política do que a ferramenta devolve).

## Leitura estrita, tipo por conteúdo, caminho nunca ao modelo

Continua bem coberto e sem achado novo: um PNG chamado `.txt` é imagem, um texto chamado `.png` é texto, um ZIP é recusado, JSON e CSV são decididos pela forma do texto. A leitura estrita vale de ponta a ponta — PDF, JSON e CSV não vão ao modelo e a ferramenta responde com o motivo. Nenhum caminho no computador chega ao modelo: a ferramenta resolve o `ref` no registro da conversa, e o teste procura um separador de caminho no que o modelo lê e falha se achar.

Fica registrado, como nas rodadas anteriores, o lado mais frágil do desenho: o registro de anexos é por conversa e não por mensagem, então o alcance do agente é a conversa inteira. É a leitura que a spec faz (o assunto é a conversa) e o critério 9 fala de outra conversa; fica como está, e é uma nota aceita, não um bloqueio.

## O que ficou fora desta revisão

- A árvore completa do diff não foi lida linha a linha fora dos arquivos que o recurso toca; a tela foi conferida por leitura e pelas asserções sobre o texto-fonte, não em execução.
- A gravação da configuração de `attachments` pelo navegador pareado (`config:cycle-save` e o `WEB_EDITABLE`) foi conferida pelo tipo, pelo esquema e pela validação; o caminho de gravação pelo navegador não foi exercitado ponta a ponta.
- O teste de política do navegador não foi reconstruído para os cinco canais nesta revisão; ele foi lido, e a lista de canais de arquivo coincide com o que o módulo declara.

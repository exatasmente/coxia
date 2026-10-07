# Revisão: arquivos na conversa e os agentes abrindo o que foi enviado

## Veredito

**Mudanças pedidas.** O bloqueante da rodada anterior (excluir uma mensagem apaga os arquivos dela) foi atendido e o caminho da exclusão funciona nos testes. Porém esta passada do desenvolvimento deixou dois bloqueantes novos, ambos introduzidos pelas linhas que ela mesma escreveu:

1. **O portão de tipos está vermelho.** `npx tsc --noEmit` termina com erro e sai com código 1 no arquivo de teste que esta passada acrescentou: a configuração montada à mão em `test/runner-answer-attachments.test.ts:62` deixa de fora o campo `limits`, que o tipo `AttachmentsConfig` exige. A doc de implementação afirma "tsc — limpo"; não é o que o portão mostra. É um dos portões obrigatórios do projeto e uma rodada vermelha não conta como pronta.
2. **A mensagem `answer` que o runner grava não tem a âncora que os dois canais de arquivo exigem, então os arquivos dela não abrem nem são apagados.** Esta passada pôs os refs dos anexos na mensagem `answer` (bom: a retenção passa a protegê-los e a mensagem os carrega), mas não pôs a âncora. `forum:attachment-get` e `forum:attachment-delete` só respondem quando a mensagem existe **e** a sua âncora é a da conversa pedida; a mensagem `answer` está numa conversa de execução (`run-<id>`), cuja âncora é `run:<id>`, e a mensagem tem `anchor: null`. Consequência verificada: nenhum anexo de uma mensagem `answer` é servido (sem miniatura, sem cartão, sem download) e excluir essa mensagem não apaga os arquivos dela do disco. Isso atinge o critério de aceite 1 pelo caminho que a pessoa de fato percorre numa conversa de execução (a resposta que a execução espera) e o critério "Deleting the message deletes its files from disk" por esse mesmo caminho, além das regras 9 e 20 da spec.

O que a rodada anterior pediu, conferido nesta:

- **Bloqueante anterior — excluir a mensagem apaga os arquivos: atendido.** O canal `forum:attachment-delete` remove a mensagem pelo `remove(thread, seq)` do armazenamento do fórum, que devolve a mensagem com os refs que ela carregava, e entrega esses refs ao `dropAll` do registro de anexos. Os refs vêm do armazenamento, nunca de quem chamou. A releitura da conversa depois de apagar (`forgetThreads`/`forgetNow` e o `nonce` de `useThread`) e o botão de apagar com confirmação existem. Os testes `forum-attachment-delete` (4) confirmam a exclusão no meio da conversa, os vizinhos intactos, o seq de outra conversa recusado e um seq já apagado sem erro — todos verdes nesta revisão.
- **Sugestão anterior — os anexos da resposta da execução: parcialmente atendida.** Os refs agora ficam na mensagem `answer` e a retenção os protege (ela lê `"attachments"` direto das linhas do `.jsonl`, sem olhar a âncora). O que ficou de fora é a âncora, e por isso a miniatura, o cartão e a exclusão desse caminho não funcionam (o achado 2 acima).
- **Sugestão anterior — juntar os pedaços de imagem do motor aberto numa única mensagem de usuário por rodada: não foi feita.** `src/main/engine/open/loop.ts:443-447` continua escrevendo uma mensagem de usuário por imagem. Segue como sugestão, não como bloqueante: era uma sugestão antes e nada novo no diff a transforma em defeito.

## O que foi verificado nesta revisão

- **Typecheck** (`npx tsc --noEmit`): **vermelho**, código de saída 1, um erro — `test/runner-answer-attachments.test.ts(62,52): Property 'limits' is missing in type '{ enabled: true; agents: false; }' but required in type 'AttachmentsConfig'`.
- **public-audit** (`node scripts/public-audit.mjs`): limpo, 926 arquivos, nada de empresa ou pessoa. Rodado direto nesta passada (a rodada anterior não o havia rodado).
- **i18n:lint** (`npm run i18n:lint`): limpo, 4127 chaves nos dois idiomas, 11 catálogos.
- **theme-audit** (`node scripts/theme-audit.mjs`): limpo, 55 pares de contraste acima de 4.5:1, sem cor literal nova além das 8 já existentes em `api.ts`.
- **Suíte completa** (`npx vitest run`): 16 falhas em 8 arquivos, mas todas são estouro de tempo sob carga (a suíte sobe 232 processos em paralelo nesta máquina). Reexecutados isoladamente, `runner-chain`, `config-migrations` e `conflict-from-mr` passam (o primeiro com 10 testes, os dois últimos com 36). As demais falhas da suíte cheia (`cycle-prompts`, `public-audit`, `sandbox-hardening`, `voice-setup`, `conflict-resolve`) são do mesmo tipo: um limite de 5 s por teste que a carga paralela estoura, e que passam sozinhos. Nenhuma delas toca o recurso de anexos. Ou seja: **a suíte inteira não foi vista verde**, mas o vermelho não indica defeito do recurso.
- **Caminho da exclusão, exercitado:** o canal `forum:attachment-delete` apaga os arquivos da mensagem e deixa os vizinhos; confirmado pelos testes `forum-attachment-delete`, verdes.
- **A âncora da mensagem `answer`, exercitada:** uma mensagem escrita como o runner a escreve (com `attachments`, sem `anchor`) fica com `anchor: null`; `forum:attachment-get` devolve `null` e `forum:attachment-delete` devolve `false` para ela. Confirmado com uma sonda descartável, removida em seguida.

Não foi verificado nesta revisão, e não pode ser dado como feito: a tela rodando (miniatura, cartão, arrastar-e-soltar, colar, seletor do telefone, e o botão de apagar com a confirmação); o envio de um arquivo perto do limite pelo corpo de 15 MB do RPC, com um aparelho pareado real; um provedor compatível real aceitando o pedaço de imagem no histórico do motor aberto; a leitura da imagem pelos dois motores produzindo a resposta que o aceite descreve (o motor fechado tem só o teste de política do que a ferramenta devolve).

## Leitura estrita, tipo por conteúdo, caminho nunca ao modelo

Continua bem coberto e sem achado novo: um PNG chamado `.txt` é imagem, um texto chamado `.png` é texto, um ZIP é recusado, JSON e CSV são decididos pela forma do texto. A leitura estrita vale de ponta a ponta — PDF, JSON e CSV não vão ao modelo e a ferramenta responde com o motivo. Nenhum caminho no computador chega ao modelo: a ferramenta resolve o `ref` no registro da conversa e o nome que a pessoa deu é dado, nunca caminho.

Fica registrado, como já ficou na rodada anterior, o lado mais frágil do desenho: o registro de anexos é por conversa, não por mensagem, então o alcance do agente é a conversa inteira. É a leitura que a spec faz (o assunto é a conversa) e o critério 9 fala de outra conversa; fica como está.

## O que ficou fora desta revisão

- A árvore completa do diff não foi lida linha a linha fora dos arquivos que o recurso toca; a tela foi conferida por leitura e pelas asserções sobre o texto-fonte, não em execução.
- A configuração de `attachments` no navegador pareado (`config:cycle-save` e o `WEB_EDITABLE`) foi conferida pelo tipo, pelo esquema e pela validação; a gravação pelo navegador não foi exercitada.
- As dezesseis falhas da suíte completa não foram uma a uma isoladas: as suspeitas de estouro de tempo ligadas ao recurso (`runner-chain`) e as de configuração/conflito foram reexecutadas isoladamente e passaram, e o padrão das restantes é o mesmo limite de tempo.

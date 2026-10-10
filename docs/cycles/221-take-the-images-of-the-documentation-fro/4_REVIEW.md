# As capturas entregues não mostram o que a documentação diz, e duas levam nomes reais para um repositório público

A revisão leu o diff da branch contra a spec e o plano, correu os gates e abriu as dez imagens de
`docs/images/` uma a uma. O que quebra não é a construção: a semeadura, os scripts de captura, a
conferência de referências, o campo de tela por etapa e a etapa do release estão no lugar, e os gates
passam. O que quebra é o que as imagens mostram.

## O veredito

**Mudanças pedidas.** Há achados bloqueantes: a documentação publica imagens que não mostram a tela
prometida e que trazem, dentro do pixel, nomes de empresa, de produto e de host que a regra do
repositório público proíbe; e o critério de aceite 4 não se cumpre só com o campo novo, porque a
sandbox exige o interruptor do espaço de trabalho ligado também.

## Achados bloqueantes

### 1. As imagens levam nomes reais para dentro de um repositório público

A auditoria pública confere conteúdo binário só pelo caminho, nunca pelos pixels (`scripts/public-audit.mjs`,
`isBinary(buf)` salta o conteúdo), então ela passa com o nome da empresa e do produto dentro dos PNGs.
A guarda que a spec nomeia é a semente com placeholders neutros — e ela não cobre o que a tela *já*
desenhava antes de o dado semeado entrar:

- `docs/images/wizard.png` mostra, no bloco de provedores, o nome do fornecedor do modelo, o nome do
  produto dele e o endereço da API dele. Nenhum desses três vem da semente: vêm dos textos neutros do
  próprio assistente de configuração, que a captura abre com uma pasta de dados vazia.
- `docs/images/today.png`, `docs/images/actions.png` e `docs/images/call.png` mostram o nome real do
  host de código (o botão “Atualizar do …” e o botão de rodapé), que o app resolve do próprio
  vocabulário de host, não da semente.
- `docs/images/today.png`, `docs/images/actions.png` e `docs/images/call.png` mostram referências de
  atividade como `app#102` e `#c103token`, que leem como número real. A spec pede o placeholder neutro
  `#123`. O `refPrefix` da semente é o que produz o `app#`; o número `102`/`103` é o `iid` do cartão.

Isso é regra do repositório violada em conteúdo versionado, e o risco já estava escrito no plano: a
“auditoria não lê pixels”.

### 2. Quatro das cinco telas não são o que a documentação promete

A `index.json`, os dois READMEs e `docs/images/README.md` dizem o que cada imagem mostra. Lidas uma a
uma:

- **`phone.png` não é o companheiro no celular.** É a janela de desktop do app reduzida a 390 px — a
  tela Hoje com a barra de navegação de baixo. O capturador abre sempre o aplicativo Electron de
  desktop; o modo web do próprio app (a PWA que o app serve em `127.0.0.1`) nunca é aberto, e o texto
  que a captura espera (“Celular/Pareado”) casa com o rótulo da seção, não com a tela do celular.
- **`actions.png` não é a fila de ações.** É a tela de conflito de release (“Conflito na #102 ao
  sincronizar com a main”), com um botão “Seguir” e um “Ver o comentário”. A fila de ações com o
  comando exato esperando a confirmação não aparece.
- **`call.png` não é “uma cerimônia em andamento”.** É a cerimônia em estado de falha: um aviso
  vermelho diz que o agente falhou porque a chave do provedor não está configurada.
- **`today.png`** mostra a tela Hoje como prometido, mas com os nomes reais do achado 1.

Só `wizard.png` mostra o que promete. Os textos que descrevem as imagens (README, `docs/images/README.md`,
`index.json`) dizem o contrário do que a imagem mostra, e é o texto que a pessoa lê.

### 3. O campo de tela por etapa não basta para a etapa ganhar tela

O critério de aceite 4 pede que uma etapa com o campo ligado receba a tela. A decisão de abrir a tela
virtual na sandbox exige **os dois** — `opts.display === true && opts.config.display === true`
(`src/main/sandbox/index.ts:270` e `:301`) — ou seja, além do campo novo da etapa, o interruptor do
espaço de trabalho `runner.sandbox.display` precisa estar ligado. Uma pessoa que só ponha `display: true`
na etapa não recebe tela nenhuma. O teste que cobre o comportamento liga os dois no `configure`
(`test/runner-stage-screen.test.ts`), por isso passa; o critério, como está escrito, não é atendido pela
etapa sozinha.

## O que segue sem verificação

Nenhuma destas foi exercitada nesta revisão e nenhuma é dada como feita:

- o aplicativo abrindo o workspace semeado sem aviso de migração (aceitação 1);
- uma etapa com o campo ligado guardando cada imagem como comprovação e conseguindo olhá-la (aceitação 4);
- um release refazendo as imagens e o pull request mostrando só o que mudou (aceitação 6);
- a captura das outras quatro funcionalidades pelo `run.mjs` inteiro: o relato da implementação só
  exercitou a captura de `today` de ponta a ponta.

## O que a revisão fez

Leu a spec, o plano e as notas da implementação; leu o diff inteiro da branch contra a base (`git diff`
sobre `src/`, `test/`, `scripts/`, `.github/`, os READMEs e o changelog, sem a pasta do ciclo); rodou
`npx tsc --noEmit`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` (5634 chaves nos dois idiomas),
`node scripts/public-audit.mjs` (1668 arquivos) e `node scripts/docs-images-check.mjs`, todos com saída 0;
rodou `npx vitest run` (435 arquivos e 7298 testes passam; 4 arquivos de navegador real falham por faltar
uma dependência neste computador, sem relação com a mudança); e abriu as dez imagens de `docs/images/`
uma a uma.

## O que fica como sugestão

- A conferência de referências chama `readdirSync(dir, { withFileTypes: true })` uma vez por nome dentro
do percurso (`scripts/docs-images-check.mjs:26`), e percorre a lista quatro vezes — custo pequeno, mas
fácil de reduzir a uma passagem.
- `entryReferenced` espalha o conjunto em array a cada chamada (`scripts/docs-images-check.mjs:63`);
um `for` sobre o próprio conjunto evitaria a cópia.
- O `stageDisplayOf` é chamado até três vezes por etapa e recalcula a lista viva a cada chamada
(`src/main/runner/executor.ts:451`, `:622`, `:664`); é o mesmo padrão do `stagePoolModeOf` ao lado, então
não destoa, mas uma leitura por etapa bastaria.
- `docs/images/README.md` ainda diz que “uma captura que a lista conhece e a pasta não tem continua
listada como pendente”, e essa lista de pendências não existe mais no arquivo.

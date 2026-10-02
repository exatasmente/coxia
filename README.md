# Coxia

Rotina pessoal: cerimônias por voz com um agente por atividade aberta (pré-daily, desbloqueio, gate, passagem para o QA, retro e conflitos de release), no desktop e no celular (PWA). Não faz parte do sz-playbook; usa o playbook como o Claude Code usa.

- **Agentes:** Claude Agent SDK com `cwd` em `~/projects`, então CLAUDE.md, skills, agentes, hooks e MCP do playbook valem como no Claude Code. Modelo `deepseek/deepseek-v4.1-flash` pelo OpenRouter (chave via `~/.local/bin/openrouter-key`). Só ferramentas de leitura (`permissionMode: dontAsk`).
- **Cartões:** `~/.local/bin/daily-report report --format json --dry-run` + fase do spec em `sz-playbook/.specs`.
- **Voz:** `sidecar/voice_sidecar.py` — faster-whisper local para ouvir; para falar, Edge TTS (padrão: nuvem da Microsoft, o texto falado sai da máquina) ou Kokoro (local, nada sai da máquina), escolhido em Configurações → Voz.
- **Escrita:** só ao clicar em "Gravar" na Ata — ata em `~/.local/share/cerimonias/workspaces/<nome>/`, nota no `daily-report`, linha no Registro do Plan. Efeitos (push, MR, comentário) não rodam aqui: são copiados para o Claude Code.

## Rodar

```bash
uv venv --python 3.12 sidecar/.venv && uv pip install --python sidecar/.venv/bin/python -r sidecar/requirements.txt
npm install
npm run build && npx electron .
```

`npm run dev` sobe com recarga automática.

### Voz local (Kokoro)

Os modelos (~350 MB) ficam em `sidecar/models/` (fora do git) ou onde `CERIMONIAS_KOKORO_DIR` apontar:

```bash
mkdir -p sidecar/models && cd sidecar/models
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

Sem `sidecar/models`, o app procura em `<userData>/voice-models/kokoro` e na pasta de `voice.kokoroDir` do config do workspace. O Kokoro só aparece como opção na instalação da voz quando esses arquivos existem.
## Instalar como app (Linux)

```bash
npm run dist
```

Gera em `dist/` (fora do git) o `cerimonias-<versão>.AppImage` e o `cerimonias_<versão>_amd64.deb`, com ícone e categoria Escritório. O binário nativo do Claude Code usado pelo SDK vai desempacotado do `app.asar`, e `sidecar/` e `resources/` vão ao lado dele (`extraResources`). O venv Python **não** vai no pacote.

`npm run dist` é o build pessoal (leva o SDK). `npm run dist:public` gera o pacote público, **sem** o Claude Agent SDK (a instalação é feita pelo assistente de configuração na primeira execução), e é o que o GitHub Actions publica; veja [`RELEASING.md`](RELEASING.md).

Instalar (manual):

```bash
sudo apt install ./dist/cerimonias_0.1.0_amd64.deb   # ou: chmod +x dist/*.AppImage && ./dist/cerimonias-0.1.0.AppImage
```

A voz é opcional e não é criada sozinha. Ao ligá-la (assistente de configuração, ou Configurações → Voz), o app confere a máquina (python3, uv, espaço em disco), cria o venv em `~/.config/cerimonias/voice-venv` com o `uv` a partir de `sidecar/requirements.txt` e baixa o modelo de fala escolhido (tiny, base ou small) em `~/.config/cerimonias/voice-models`. Precisa de rede e leva alguns minutos; se for cancelada ou falhar, a próxima tentativa continua de onde parou, e o erro vai para o registro de erros. Desligada, nenhum processo de voz é iniciado e o app funciona por texto. Em dev (`npm run dev`, `npx electron .`) o `sidecar/.venv` continua valendo, sem reinstalar. Detalhes em `docs/voice.md`.

**Abrir ao entrar no sistema:** Configurações → Início → "Abrir ao entrar no sistema". Cria `~/.config/autostart/cerimonias.desktop` (desmarcar remove) apontando para o AppImage que está rodando, para o binário instalado pelo `.deb` ou, em dev, para o `electron` deste repositório. O entry usa `--hidden`: o app começa só na bandeja, sem janela. Se mover ou apagar o AppImage, marque a opção de novo.

## Instalar para uso diário

Para usar o app instalado e deixar o `npx electron .` só para desenvolver:

```bash
npm run dist                       # gera dist/cerimonias-<versão>.AppImage (leva alguns minutos)
scripts/install-local.sh           # instala só no seu usuário
scripts/install-local.sh --autostart   # idem, e abre ao entrar no sistema (opcional)
```

O script copia o AppImage mais novo de `dist/` para `~/.local/opt/cerimonias/cerimonias.AppImage`, o ícone para `~/.local/share/icons/hicolor/256x256/apps/` e cria `~/.local/share/applications/cerimonias.desktop` (aparece no menu de aplicativos). Com `--autostart` escreve `~/.config/autostart/cerimonias.desktop` apontando para o AppImage instalado, com `--hidden`; sem a flag, não mexe nisso e avisa se o entry existente aponta para outro lugar (por exemplo, a árvore de desenvolvimento). Rodar de novo é seguro: o que não mudou é deixado como está e o AppImage novo troca o antigo por renomeação. Cada passo é impresso. Precisa de `libfuse2` (`sudo apt install libfuse2t64`) para o AppImage abrir.

Para atualizar o app instalado, veja [Atualizar](#atualizar).

**Dev e instalado juntos:** os dois usam o mesmo nome de app (`cerimonias`), então compartilham os dados (`~/.local/share/cerimonias`: workspaces com atas, histórico e configurações; acesso pelo navegador, aparelhos pareados e glossário na raiz) **e** o `userData` do Electron (`~/.config/cerimonias`), e com ele o bloqueio de instância única. Na prática, **só uma instância roda por vez**: abrir a outra enquanto uma está aberta só traz a janela da primeira para a frente. Para testar o código em desenvolvimento, feche o instalado; para voltar, feche o dev. O que muda de um para o outro é onde ficam o código e o venv da voz (dev: `sidecar/.venv`; instalado: `~/.config/cerimonias/voice-venv`, criado na primeira abertura, com rede). Para rodar uma cópia isolada de teste, aponte `CERIMONIAS_DATA_DIR` (e `CERIMONIAS_SPECS_DIR`) para uma pasta de teste: o `userData` passa a ficar dentro dela.

O pacote não leva os modelos do Kokoro; a voz local lê `CERIMONIAS_KOKORO_DIR`, `<userData>/voice-models/kokoro` ou `voice.kokoroDir`.

## Atualizar

Depois de `git pull` (ou de commitar uma mudança), um comando só recompila, fecha o app em uso, instala a versão nova e abre de novo:

```bash
scripts/update.sh
```

Passos, nesta ordem (cada um é impresso e vai para `~/.local/state/cerimonias/update.log`):

1. **Confere a árvore.** Recusa e lista os arquivos se houver mudança não commitada em `src/` (`--force-dirty` ignora, e o build sai marcado `+dirty`).
2. **Compila** com `npm run dist` (log em `~/.local/state/cerimonias/build.log`, leva alguns minutos). Se falhar, mostra o final do log e **sai sem tocar no app instalado**.
3. **Pede ao app em uso que feche.** O script abre o binário instalado com `--quit-for-update`: a instância que está rodando recebe o pedido (instância única), manda a janela salvar a cerimônia do dia e sai pelo caminho normal; a instância nova que fez o pedido sai na hora. Ele espera o processo sumir (até 45 s, `--timeout <s>`). Se não sumir, para com uma mensagem clara, sem instalar nada e sem matar o app; `--kill` envia SIGTERM (e SIGKILL só depois de 10 s). Fechar assim, e não matando o AppImage, evita o "Erro no barramento" (SIGBUS) que acontece quando o ponto de montagem some debaixo de um app vivo. Antes de sair, o app também encerra os processos que ele mesmo abriu (`git fetch`, `glab`, `daily-report`, a voz): cada um segura arquivos do ponto de montagem do AppImage, e um que continuasse rodando impediria o AppImage de desmontar e terminar. Ações de release e resoluções de conflito já são gravadas em disco a cada passo; o que não sobrevive é uma chamada de agente ou de voz no meio da execução. O script também fecha os arquivos que herda do app, pelo mesmo motivo.
4. **Instala** com `scripts/install-local.sh`, sem mexer no autostart: ligado continua ligado, desligado continua desligado.
5. **Abre o app novo**, separado do terminal (`setsid`/`nohup`), com a saída em `~/.local/state/cerimonias/app.log`, e imprime a versão e o commit que ele informou (`<dados>/run.json`).

Outras opções: `--no-build` reaproveita o `dist/*.AppImage` mais novo, `--hidden` abre só na bandeja, `--no-start` instala sem abrir, `--check` só confere se dá para atualizar (é o que o botão do app roda antes de começar). Duas atualizações ao mesmo tempo não rodam (a segunda recusa).

**Pelo app:** Configurações → Atualizações mostra a versão instalada (versão, commit e data da compilação, gravados no build) e, numa instalação feita por `scripts/install-local.sh` (é o caso de quem usa este script), quantos commits a `main` da árvore de código tem além do commit instalado, com a lista deles (só leitura; `git fetch` só se você ligar). Há um aviso "Atualização disponível" na barra de cima do Hoje e o botão "Atualizar agora", que pede confirmação e roda `scripts/update.sh` separado do app. O app fecha sozinho no fim da compilação e, na primeira abertura depois, avisa uma vez "Atualizado para &lt;commit&gt;". A seção só existe na janela do app, não no navegador, e em desenvolvimento (`npx electron .`) o botão apenas explica que só vale no app instalado. O `install-local.sh` grava em `~/.local/state/cerimonias/install-source.json` qual árvore gerou a instalação. Versões publicadas (AppImage baixado de um release) se atualizam sozinhas: veja [`docs/updates.md`](docs/updates.md).

**Primeira vez:** o app instalado antes desta versão ainda não entende `--quit-for-update`. Na primeira atualização o script espera, avisa e, se o app não fechar, feche-o com "Sair" na bandeja e rode `scripts/update.sh --no-build` para continuar sem recompilar.

**Variáveis** (para testar sem tocar na instalação real): `CERIMONIAS_PREFIX`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `CERIMONIAS_DATA_DIR` e `CERIMONIAS_APP_ARGS` (argumentos extras em toda abertura do app, por exemplo `--user-data-dir=...`); `CERIMONIAS_SOURCE_DIR` aponta a árvore que a tela consulta e atualiza, no lugar da registrada por `install-local.sh`.

## Workspaces

Histórico, ações e configurações vivem em workspaces: `<dados>/workspaces/<id>/`, listados em `<dados>/workspaces.json` (`current` e a lista com nome, data e a marca de testes). Na primeira abertura depois da atualização, o que já existia é movido, sem apagar nada, para o workspace **Testes** (marca de testes ligada), que passa a ser o atual; o que moveu fica em `workspaces/migration.log`. Se a migração for interrompida, a próxima abertura termina o que faltou.

- **Por workspace:** `config.json` (sem o bloco `web`), ata, `historico/`, `acoes.json`, `conflicts/`, `custo.json`, `falas.json`, `status.json`, `radar.json`, `watchers.json`, `efeitos.json`, `feedback.json` e `feedback/`, `auditoria.jsonl`, `retencao.log`, `atividade/`, `gates/`, `qa/`, `retros/`.
- **Na raiz, valem para todos:** `web.json` (acesso pelo navegador), `web-sessions.json` (aparelhos pareados), `web-push-vapid.json` e `web-push.json`, `glossario.json`, `conflict-verify.json`, `saude.json` e `userData/` (instância de teste).
- **Marca de testes:** com ela ligada, nada sai da máquina: aprovar ação (GitLab, push, comentário), gravar no Plan, na nota do daily-report, no QA_CHECKLIST e no GATE_QUIZ é recusado. Se o registro não puder ser lido, vale como testes.
- **Trocar** (Configurações › Workspaces › Usar este) grava o registro e reinicia o app; pelo navegador a página recarrega sozinha. Excluir move a pasta para `workspaces/.trash/<id>-<data>`; nunca apaga.

## Tempo por issue (Clockify)

O app grava, a cada 20 min no horário de trabalho e ao abrir a tela Hoje, o tempo medido nas cerimônias do dia em `~/.local/share/cerimonias/workspaces/<nome>/atividade/<AAAA-MM-DD>.json`. É um retrato do dia, reescrito a cada vez; o app **não** chama o Clockify.

- **De onde vem:** pré-daily (da primeira fala de cada atividade até a primeira da próxima; pausa de mais de 10 min na call não conta), desbloqueios (mensagens da conversa), gates, passagem para o QA e retro (da criação até a última gravação do arquivo da cerimônia). Retro e call sem atividade entram como `Cerimônias - Retro semanal` e `Cerimônias - Daily`.
- `blocks`: no formato dos blocos do `clockify-log activity` (`start`, `end`, `minutes`, `projects`, `gitlab_ids`, `events`), mais `ceremony`, `ref`, `sessionId` e `description`. Podem se sobrepor (um desbloqueio acontece dentro da call).
- `entries`: o mesmo tempo cortado em pedaços sem sobreposição (o desbloqueio fica com o seu trecho, a call com o resto), com `start`, `end` e `description` (uma linha, até 60 caracteres, começando por `#<issue> -`), prontos para o `add`.
- `issues`: minutos por issue e por cerimônia (é o que o cartão "Tempo de hoje por issue" mostra).

Para lançar, sem mexer no `clockify-log`:

```bash
jq '.entries' ~/.local/share/cerimonias/atividade/2026-10-02.json | ~/.local/bin/clockify-log add --entries - --dry-run
```

Tire o `--dry-run` para criar. O `add` recusa o que se sobrepõe ao que já está lançado, então a ordem importa: lance o arquivo do app antes dos blocos do `activity`. As sessões dos agentes também aparecem no `activity` (projeto `home`), e esses blocos cobrem o mesmo tempo; ao integrar de vez, o `activity` deve descartar os blocos que o app já cobre e usar `entries` no lugar. Só vale trabalho da Fortics: confira antes de lançar.

## Custo (OpenRouter)

A tela **Custo** (botão no topo da Hoje) lê o uso da chave (`GET /api/v1/key`) e, de cada chamada das sessões do app em `~/.claude/projects/-home-luiz-neto-projects/*.jsonl`, o preço real (`GET /api/v1/generation?id=gen-…`). As sessões são reconhecidas pelo primeiro prompt (pré-daily, desbloqueio, gate, passagem para o QA, retro, texto do Teams, release). O preço de cada chamada é guardado em `~/.local/share/cerimonias/workspaces/<nome>/custo.json`: depois da primeira leitura só o que é novo é consultado. A meta mensal (padrão US$ 20) fica no mesmo arquivo. A chave só é lida no processo principal e nunca é registrada.

## Continuar no Claude Code com o pedido

`claude --resume <sessão> "<prompt>"` abre a sessão já com o pedido (o `claude-or` repassa os argumentos). O app grava o prompt num arquivo temporário privado e o terminal o lê por `"$(cat "$2")"`; nada do texto passa por interpolação de shell. Na Ata, cada efeito da fila tem "Executar no Claude Code" (sem sessão de agente, "Copiar pedido").

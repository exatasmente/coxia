# Cerimônias

Rotina pessoal: pré-daily por voz com um agente por atividade aberta. Não faz parte do sz-playbook; usa o playbook como o Claude Code usa.

- **Agentes:** Claude Agent SDK com `cwd` em `~/projects`, então CLAUDE.md, skills, agentes, hooks e MCP do playbook valem como no Claude Code. Modelo `deepseek/deepseek-v4.1-flash` pelo OpenRouter (chave via `~/.local/bin/openrouter-key`). Só ferramentas de leitura (`permissionMode: dontAsk`).
- **Cartões:** `~/.local/bin/daily-report report --format json --dry-run` + fase do spec em `sz-playbook/.specs`.
- **Voz:** `sidecar/voice_sidecar.py` — faster-whisper local para ouvir; para falar, Edge TTS (padrão: nuvem da Microsoft, o texto falado sai da máquina) ou Kokoro (local, nada sai da máquina), escolhido em Configurações → Voz.
- **Escrita:** só ao clicar em "Gravar" na Ata — ata em `~/.local/share/cerimonias/`, nota no `daily-report`, linha no Registro do Plan. Efeitos (push, MR, comentário) não rodam aqui: são copiados para o Claude Code.

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

Sem `sidecar/models`, o sidecar também procura em `~/projects/hermes-poc/vendor/kokoro`.
## Instalar como app (Linux)

```bash
npm run dist
```

Gera em `dist/` (fora do git) o `cerimonias-<versão>.AppImage` e o `cerimonias_<versão>_amd64.deb`, com ícone e categoria Escritório. O binário nativo do Claude Code usado pelo SDK vai desempacotado do `app.asar`, e `sidecar/` e `resources/` vão ao lado dele (`extraResources`). O venv Python **não** vai no pacote.

Instalar (manual):

```bash
sudo apt install ./dist/cerimonias_0.1.0_amd64.deb   # ou: chmod +x dist/*.AppImage && ./dist/cerimonias-0.1.0.AppImage
```

Na primeira vez que o app instalado abre, ele cria o venv da voz em `~/.config/cerimonias/voice-venv` com o `uv` (`~/.local/bin/uv`) a partir de `sidecar/requirements.txt`. Precisa de rede e leva alguns minutos; a voz só responde depois disso. Se falhar, o erro aparece na tela e a próxima tentativa refaz tudo. Em dev (`npm run dev`, `npx electron .`) continua valendo `sidecar/.venv`.

**Abrir ao entrar no sistema:** Configurações → Início → "Abrir ao entrar no sistema". Cria `~/.config/autostart/cerimonias.desktop` (desmarcar remove) apontando para o AppImage que está rodando, para o binário instalado pelo `.deb` ou, em dev, para o `electron` deste repositório. O entry usa `--hidden`: o app começa só na bandeja, sem janela. Se mover ou apagar o AppImage, marque a opção de novo.

## Instalar para uso diário

Para usar o app instalado e deixar o `npx electron .` só para desenvolver:

```bash
npm run dist                       # gera dist/cerimonias-<versão>.AppImage (leva alguns minutos)
scripts/install-local.sh           # instala só no seu usuário
scripts/install-local.sh --autostart   # idem, e abre ao entrar no sistema (opcional)
```

O script copia o AppImage mais novo de `dist/` para `~/.local/opt/cerimonias/cerimonias.AppImage`, o ícone para `~/.local/share/icons/hicolor/256x256/apps/` e cria `~/.local/share/applications/cerimonias.desktop` (aparece no menu de aplicativos). Com `--autostart` escreve `~/.config/autostart/cerimonias.desktop` apontando para o AppImage instalado, com `--hidden`; sem a flag, não mexe nisso e avisa se o entry existente aponta para outro lugar (por exemplo, a árvore de desenvolvimento). Rodar de novo é seguro: o que não mudou é deixado como está e o AppImage novo troca o antigo por renomeação. Cada passo é impresso. Precisa de `libfuse2` (`sudo apt install libfuse2t64`) para o AppImage abrir.

**Atualizar:** `git pull`, `npm run dist`, `scripts/install-local.sh`, e fechar e abrir o app. O venv da voz e os dados não são tocados.

**Dev e instalado juntos:** os dois usam o mesmo nome de app (`cerimonias`), então compartilham os dados (`~/.local/share/cerimonias`: atas, histórico, configurações) **e** o `userData` do Electron (`~/.config/cerimonias`), e com ele o bloqueio de instância única. Na prática, **só uma instância roda por vez**: abrir a outra enquanto uma está aberta só traz a janela da primeira para a frente. Para testar o código em desenvolvimento, feche o instalado; para voltar, feche o dev. O que muda de um para o outro é onde ficam o código e o venv da voz (dev: `sidecar/.venv`; instalado: `~/.config/cerimonias/voice-venv`, criado na primeira abertura, com rede). Para rodar uma cópia isolada de teste, aponte `CERIMONIAS_DATA_DIR` (e `CERIMONIAS_SPECS_DIR`) para uma pasta de teste: o `userData` passa a ficar dentro dela.

O pacote não leva os modelos do Kokoro; a voz local continua lendo `CERIMONIAS_KOKORO_DIR` ou `~/projects/hermes-poc/vendor/kokoro`.

## Tempo por issue (Clockify)

O app grava, a cada 20 min no horário de trabalho e ao abrir a tela Hoje, o tempo medido nas cerimônias do dia em `~/.local/share/cerimonias/atividade/<AAAA-MM-DD>.json`. É um retrato do dia, reescrito a cada vez; o app **não** chama o Clockify.

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

A tela **Custo** (botão no topo da Hoje) lê o uso da chave (`GET /api/v1/key`) e, de cada chamada das sessões do app em `~/.claude/projects/-home-luiz-neto-projects/*.jsonl`, o preço real (`GET /api/v1/generation?id=gen-…`). As sessões são reconhecidas pelo primeiro prompt (pré-daily, desbloqueio, gate, passagem para o QA, retro, texto do Teams, release). O preço de cada chamada é guardado em `~/.local/share/cerimonias/custo.json`: depois da primeira leitura só o que é novo é consultado. A meta mensal (padrão US$ 20) fica no mesmo arquivo. A chave só é lida no processo principal e nunca é registrada.

## Continuar no Claude Code com o pedido

`claude --resume <sessão> "<prompt>"` abre a sessão já com o pedido (o `claude-or` repassa os argumentos). O app grava o prompt num arquivo temporário privado e o terminal o lê por `"$(cat "$2")"`; nada do texto passa por interpolação de shell. Na Ata, cada efeito da fila tem "Executar no Claude Code" (sem sessão de agente, "Copiar pedido").

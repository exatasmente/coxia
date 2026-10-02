# Cerimônias

Rotina pessoal: pré-daily por voz com um agente por atividade aberta. Não faz parte do sz-playbook; usa o playbook como o Claude Code usa.

- **Agentes:** Claude Agent SDK com `cwd` em `~/projects`, então CLAUDE.md, skills, agentes, hooks e MCP do playbook valem como no Claude Code. Modelo `deepseek/deepseek-v4.1-flash` pelo OpenRouter (chave via `~/.local/bin/openrouter-key`). Só ferramentas de leitura (`permissionMode: dontAsk`).
- **Cartões:** `~/.local/bin/daily-report report --format json --dry-run` + fase do spec em `sz-playbook/.specs`.
- **Voz:** `sidecar/voice_sidecar.py` — faster-whisper local para ouvir, Edge TTS (nuvem da Microsoft: o texto falado sai da máquina) para falar.
- **Escrita:** só ao clicar em "Gravar" na Ata — ata em `~/.local/share/cerimonias/`, nota no `daily-report`, linha no Registro do Plan. Efeitos (push, MR, comentário) não rodam aqui: são copiados para o Claude Code.

## Rodar

```bash
uv venv --python 3.12 sidecar/.venv && uv pip install --python sidecar/.venv/bin/python -r sidecar/requirements.txt
npm install
npm run build && npx electron .
```

`npm run dev` sobe com recarga automática.

## Tempo por issue (Clockify)

O app grava, a cada 20 min no horário de trabalho e ao abrir a tela Hoje, o tempo medido nas cerimônias do dia em `~/.local/share/cerimonias/atividade/<AAAA-MM-DD>.json`. É um retrato do dia, reescrito a cada vez; o app **não** chama o Clockify.

- **De onde vem:** pré-daily (da primeira fala de cada atividade até a primeira da próxima; pausa de mais de 10 min na call não conta), desbloqueios (mensagens da conversa), gates, passagem para o QA e retro (da criação até a última gravação do arquivo da cerimônia). Retro e call sem atividade entram como `Cerimônias - Retro semanal` e `Cerimônias - Daily`.
- `blocks`: no formato dos blocos do `clockify-log activity` (`start`, `end`, `minutes`, `projects`, `gitlab_ids`, `events`), mais `ceremony`, `ref`, `sessionId` e `description`. Podem se sobrepor (um desbloqueio acontece dentro da call).
- `entries`: o mesmo tempo cortado em pedaços sem sobreposição (o desbloqueio fica com o seu trecho, a call com o resto), com `start`, `end` e `description` (uma linha, até 60 caracteres, começando por `#<issue> -`), prontos para o `add`.
- `issues`: minutos por issue e por cerimônia (é o que o cartão "Tempo de hoje por issue" mostra).

Para lançar, sem mexer no `clockify-log`:

```bash
python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["entries"]))' ~/.local/share/cerimonias/atividade/2026-10-02.json \
  | ~/.local/bin/clockify-log add --entries - --dry-run
```

Tire o `--dry-run` para criar. O `add` recusa o que se sobrepõe ao que já está lançado, então a ordem importa: lance o arquivo do app antes dos blocos do `activity`. As sessões dos agentes também aparecem no `activity` (projeto `home`), e esses blocos cobrem o mesmo tempo; ao integrar de vez, o `activity` deve descartar os blocos que o app já cobre e usar `entries` no lugar. Só vale trabalho da Fortics: confira antes de lançar.

## Custo (OpenRouter)

A tela **Custo** (botão no topo da Hoje) lê o uso da chave (`GET /api/v1/key`) e, de cada chamada das sessões do app em `~/.claude/projects/-home-luiz-neto-projects/*.jsonl`, o preço real (`GET /api/v1/generation?id=gen-…`). As sessões são reconhecidas pelo primeiro prompt (pré-daily, desbloqueio, gate, passagem para o QA, retro, texto do Teams, release). O preço de cada chamada é guardado em `~/.local/share/cerimonias/custo.json`: depois da primeira leitura só o que é novo é consultado. A meta mensal (padrão US$ 20) fica no mesmo arquivo. A chave só é lida no processo principal e nunca é registrada.

## Continuar no Claude Code com o pedido

`claude --resume <sessão> "<prompt>"` abre a sessão já com o pedido (o `claude-or` repassa os argumentos). O app grava o prompt num arquivo temporário privado e o terminal o lê por `"$(cat "$2")"`; nada do texto passa por interpolação de shell. Na Ata, cada efeito da fila tem "Executar no Claude Code" (sem sessão de agente, "Copiar pedido").

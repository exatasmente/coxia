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

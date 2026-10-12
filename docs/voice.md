# Voice is optional

`voice.enabled` in the workspace config is the master switch. A fresh install starts with it **off**; an install that predates the configuration keeps it **on** (`voice.depsInstalled: true`, its own `voice-venv` or `sidecar/.venv` untouched).

## What "off" means

- No sidecar process is started (`startVoice()` returns before anything happens), none is spawned by a request, and none is created behind your back: with the dependencies missing, turning voice on only works after `voice:install`.
- No microphone UI in the ceremonies: the mic buttons, the space shortcut, the barge-in monitor and the recorder are gone; no replay buttons; the "Voz ligada/desligada" speaker switch in the header of the chat is hidden (it is a sub-option of voice). The persona's chat keeps its voice buttons, and a tap only shows a note that points to Settings → Voz (see below); nothing records or downloads.
- No synthesis: `voice:plan` returns nothing, the player returns at once (no reading-time wait), `voice:segment` and `voice:transcribe` refuse.
- Every screen works by text through the composers that were always there.
- The health panel reports the voice as "off" (not as a failure).
- The agents are told so: see `src/main/agentVoice.ts`. The output schemas do not change; with voice off the `fala` field is just the short message the screen shows.

Turning it off from Settings → Voz (or `voice:enable(false)`) stops the running sidecar without logging an error. Anything that changes the config (Settings, the wizard, an import) goes through `onConfigChange`, which starts or stops the sidecar and tells the screens (`settings` event).

## Talking to the persona

The renderer's audio lives in `src/renderer/src/voice/` (`audio.ts` re-exports it, so the ceremony screens did not change). The persona's chat and voice mode use it:

- **Chat:** beside the box, talk (push-to-talk: tap, speak, tap again or go quiet), hands-free (listens again after each answer) and voice mode. The gate (`voiceGate.ts`) records only when voice is on, installed and the page can record; otherwise the tap shows a note (with a button to Settings on the computer; a paired phone is told to turn voice on on the computer, and a page over plain http is told that recording needs https).
- **Voice mode** (`{ name: 'voice' }`, Ctrl/Cmd+Shift+M on the computer): full screen, hands-free from the start, state (listening, thinking, speaking, muted, paused), captions on/off, mute and end. It is the same conversation as the chat. On a paired phone a hidden page pauses it (microphone closed, speech stopped) until a tap resumes; the computer keeps listening without focus. A wake lock keeps the screen on where the browser offers one. On iOS, which has no barge-in, a button interrupts.
- **The turn:** the transcription is posted with `forum:post(thread, text, 'voice')`; the message keeps `origin: 'voice'` and the persona's prompt gets `prompt.sdd.runner.mention.persona.voice` (short, no Markdown, announce a long action, a spoken "yes" approves nothing on screen). Only the device that posted the turn speaks the answer, sentence by sentence from the live text (`sentences.ts`, `voiceTurns.ts`, `player.sayStream`), with barge-in on while it speaks. A recording that heard no speech is dropped, never transcribed.
- **Latency:** each turn logs one line (`voice turn latency ms: total=…`) to the developer tools' console, from the end of speech to the first word played.
- **Privacy:** with Edge, the persona's answers read aloud go to Microsoft too; Settings → Voz says so.

## Terminology: "call" or "conversa" / "chat"

With voice on the app says **call** (as it always did). With voice off:

| pt-BR | English (voice on / voice off) |
|---|---|
| Entrar na call / Entrar na conversa | Join the call / Join the chat |
| Voltar à call / Voltar à conversa | Back to the call / Back to the chat |
| Controles da call / da conversa | Call controls / Chat controls |
| Call em andamento / Conversa em andamento | Call in progress / Chat in progress |
| Depois da call / Depois da conversa | After the call / After the chat |
| bottom nav "Call" / "Conversa" (icon: microphone / bubble) | Call / Chat |
| notification "Os agentes estão prontos para a call" / "...para a conversa" | ready for the call / ready for the chat |

English picks **chat** (short enough for the bottom nav and the buttons), pt-BR **conversa**; never "conversation".

It is done with keys and a voice-aware translator, never a string replace: `tv('call.enter')` (`src/shared/i18n`) reads `call.enter` while voice is on and `call.enter.novoice` while it is off, and falls back to the plain key when a string has no variant. `t()` does not follow the voice state. The state is set from the config in the main process (`workspaceConfig`) and in the renderer (`applyVoiceMode`, from `settings:get` and the `settings` event; the last value is cached in localStorage so the first paint is right). In a component call `useTv()` or `useVoiceEnabled()` to re-render on a change (the whole tree already re-renders from `App`).

A new string that says "call" gets both keys in `pt-BR.json` and `en.json`; `test/voice-terminology.test.ts` checks that every `.novoice` variant exists in both languages, keeps its placeholders, and never says "call".

The prompts the app sends keep their first words as identifiers for the cost, retention and session index (`custo-core`, `retention-core`, `sessions-core`); those regexes accept both forms (`Desbloqueio por voz|em texto da atividade`, `Call|Conversa de reentrada`, ...).

## The setup API (channels `voice:*`)

Desktop only (`webPolicy.ts`), except `voice:status`. Types and the progress event are in `src/shared/voiceSetup.ts`; the renderer wrapper is `src/renderer/src/voiceApi.ts`; the implementation is `src/main/voice-setup.ts` (no Electron, testable with a fake uv/python on PATH) and `src/main/voiceModule.ts`.

| Channel | Arguments | Returns |
|---|---|---|
| `voice:status` | | `{ enabled, depsInstalled, engine, sttModel, running, ready, installing }` |
| `voice:check` | model name, or the wizard's options object | `VoiceCheck`: python3 version, uv found/installable, free disk vs needed, what is installed (`kind: data / legacy`), models downloaded, the two engines (Edge: `local: false, sendsTextTo: "Microsoft"`; Kokoro: available when its model files exist), problems, `canInstall`, and a `message` sentence |
| `voice:install` | `{ sttModel: tiny / base / small, engine, acknowledgeEdge?, enable? }` | `{ ok: true, enabled, ... }`, `{ ok: false, cancelled: true }` or `{ ok: false, code, phase, message, detail }`; one long call |
| `voice:install-cancel` | | `true` when an install was running |
| `voice:test` | | `VoiceTestResult`: speaks a fixed sentence with the configured engine and transcribes it back |
| `voice:uninstall` | | `{ freedBytes, left }`; stops the sidecar, removes the app's venv, models and tools, sets `enabled` and `depsInstalled` |
| `voice:enable` | `boolean` | `{ enabled, needsInstall }`; on without the dependencies changes nothing |

Progress: the module event `voice:progress` (`{ type: 'module', name: 'voice:progress', payload: VoiceProgress }`), with `phase` (`check`, `uv`, `venv`, `packages`, `model`, `verify`, `done`, `failed`, `cancelled`), an overall `percent` (null while a phase cannot tell), `bytes` during the model download and the last line of the tool in `detail`. Every message a person reads is chosen by the screen from `phase` and `code` (`voice.phase.*`, `voice.fail.*`, `voice.problem.*`).

Install steps, each skipped when its result is already there, so a cancel or a failure is resumed by running it again: uv (the one on the machine, else `python3 -m venv` + `pip install uv` into `<userData>/voice-tools`), the environment (`uv venv --python 3.12` into `<userData>/voice-venv`), the packages (`uv pip install -r sidecar/requirements.txt`, then the `.cerimonias-ready` marker), the model (`sidecar/voice_fetch.py` into `<userData>/voice-models`, plain HTTP so the partial file resumes), and an import check. A failure goes to the error log (`source: voice:install`, with the phase). An environment that already exists (a migrated install, or the checkout's `sidecar/.venv`) is never reinstalled; the install then only fetches a missing model.

**Edge sends text to Microsoft.** `voice:install` refuses `engine: "edge"` unless `acknowledgeEdge` is true; Settings → Voz and the wizard show the sentence (`voice.engine.edge.warn`) and ask for the acknowledgement, and offer Kokoro (local) as the other radio, enabled only when its model files are present. `voice:test` with Edge sends the test sentence ("Olá, este é um teste da voz do Coxia.").

## Where things live

- `<userData>/voice-venv`, `voice-models` (the sidecar gets `HF_HOME` pointing here only when it holds the chosen model; otherwise the user's own Hugging Face cache is used, so a migrated user's "small" is found without a download), `voice-tools`. With `CERIMONIAS_DATA_DIR` set, `userData` is inside it.
- Uninstall removes only those three. The checkout's `sidecar/.venv` and the shared `~/.cache/huggingface` stay.
- Kokoro files: `CERIMONIAS_KOKORO_DIR`, `sidecar/models`, `<userData>/voice-models/kokoro`, or `voice.kokoroDir` (a legacy profile can point it at your own folder; nothing in the code does).

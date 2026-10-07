---
checked-commit: 1a0858c59ed1d4c43e03feb3e709bbefd8441336
checked-date: 2026-10-06
evidence: [docs/voice.md:1-45, src/main/voice.ts, src/main/voiceModule.ts, src/shared/voiceSetup.ts, src/shared/i18n/terms.ts, test/voice-terminology.test.ts, test/voice-gating.test.ts]
summary: Voice is optional: what "off" means, the engines, the setup and the wording variants
stages: [development, review]
roles: [developer]
---

# Voice

Voice is optional and off by default. Everything in the app works by text, and the code is
written so that voice off is the ordinary case, not an afterthought.

## What "off" means

`voice.enabled` turns everything off: no sidecar, no microphone, no speech synthesis. When
voice is off, the wording follows: the app says "chat" (English) or "conversa" (Portuguese)
where it would say "call". That is done with the second key of `tv()`/`useTv()`, never a string
replace (`rules/i18n.md`): `tv('call.enter')` reads `call.enter` with voice on and
`call.enter.novoice` with it off. Every string that says "call" needs a `.novoice` variant in
both languages, keeping the same placeholders and never saying "call".

## The engines

Listening is always local (Whisper, in a Python sidecar). Speaking is either Edge TTS (a cloud
service) or Kokoro (local). With Kokoro, nothing leaves the machine; with Edge TTS, the text to
be spoken goes to Microsoft's online voice service. The privacy table in the root `README.md`
spells out what leaves.

## Setup

From source:

```bash
uv venv --python 3.12 sidecar/.venv
uv pip install --python sidecar/.venv/bin/python -r sidecar/requirements.txt
```

PyPI and Hugging Face (and the Kokoro model files, if chosen) are reached only when voice is
turned on. The setup channels are `voice:*`; the ones that install software, delete files or
start processes (`voice:check`, `-install`, `-install-cancel`, `-test`, `-uninstall`,
`-enable`) are desktop-only (`src/main/webPolicy.ts`), while `voice:status` is a read and stays
open to a paired browser. The Python voice sidecar is **not part of CI**: it needs the models
and a local audio stack, and it has no automated tests of its own.

## Where the tests are

`test/voice-terminology.test.ts` checks the catalog rules for the `.novoice` variants;
`test/voice-gating.test.ts` checks what voice off gates; `test/voice-setup.test.ts`,
`test/speech.test.ts`, `test/vad.test.ts` and `test/transcribe-audio.test.ts` cover the rest.

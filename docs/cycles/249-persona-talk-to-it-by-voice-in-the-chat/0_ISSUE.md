# 249 Persona: talk to it by voice, in the chat and in a voice mode

- Endereço: https://github.com/exatasmente/coxia/issues/249
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

Part of #245.

## What should happen

### Voice in the chat

- **Talking to the persona.** The person talks to the persona in the chat by voice: push-to-talk and a hands-free mode, with barge-in to interrupt.
- **Spoken answers.** The persona answers aloud with its own voice, and the text is shown as it is spoken.

### Voice mode

A screen of its own for a spoken conversation with the persona, the way other voice assistants work. It is not a ceremony: no agenda, no stand-up, just talking.

- **Full screen.** A visual that reacts to the audio and shows the state: listening, thinking, speaking. Captions can be turned on or off. Buttons to mute the microphone and to end the conversation.
- **Hands-free by default.** Once started, it keeps listening, answering and listening again until the person ends it. Barge-in works at any moment: speaking while the persona talks stops it and the new request is heard.
- **Speaks before the answer is complete.** Speech starts with the first complete sentence of the answer as it is written (the live text the chat already receives), not after the whole answer arrives. The next sentence is synthesized while the current one plays.
- **Answers written for listening.** When a turn comes from voice, the persona is told to answer short and without markdown, tables or code blocks. A long action is announced in one sentence ("opening the pull request, one moment") and its result summarized, not read out.
- **Same conversation.** What is said and answered goes to the same persona conversation as the chat. Leaving voice mode shows the whole exchange there, transcribed.
- **Entry points.** Voice mode opens from the chat (a button next to the composer) and from a shortcut. On the paired phone it can be the main way in.

### Shared

- **Reuse.** It reuses the voice sidecar and the recorder, player, voice-activity and barge-in code that the ceremony screens use today (`audio.ts`, `useRecorder`, `usePlayer`, `useTalk`, `bargeMonitor`), moved into a shared component used by the chat, voice mode and the ceremonies.
- **Phone and computer.** Voice works on the computer and, where the browser allows recording, on the paired phone.
- **Voice off.** With the voice not installed or turned off, the voice controls say so and point to the voice settings; nothing is downloaded.

## Open questions for refinement

- Whether a spoken "yes" is enough when the persona asks before acting, or whether those confirmations stay on screen.
- The delay between the end of the person's speech and the first spoken word (transcription happens after the speech ends): measure it and set a target.
- How voice mode behaves when the screen locks or the window loses focus, on the computer and on the phone.

## Acceptance

- A spoken request to the persona is transcribed, acted on and answered aloud.
- Speaking while the persona talks interrupts it.
- In voice mode the conversation continues hands-free until the person ends it, and the exchange appears in the persona's chat afterwards.
- The first sentence of an answer is spoken before the answer is complete.
- An answer to a voice turn has no markdown read aloud.

## Comentários

(sem comentários)

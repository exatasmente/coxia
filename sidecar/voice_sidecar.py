"""Voice sidecar: speech-to-text (faster-whisper, local) and text-to-speech (Edge TTS in the cloud, or Kokoro local).

Protocol: one JSON object per line on stdin, one JSON reply per line on stdout.
  {"id": 1, "cmd": "stt", "path": "/tmp/x.webm"}                      -> {"id": 1, "text": "..."}
  {"id": 2, "cmd": "tts", "text": "...", "voice": "...", "rate": "+0%", "pitch": "+0Hz", "out": "/tmp/y.mp3"}
                                                                       -> {"id": 2, "path": "/tmp/y.mp3"}
  {"id": 3, "cmd": "tts", "engine": "kokoro", "text": "...", "voice": "pf_dora", "speed": 1.05, "out": "/tmp/z.wav"}
                                                                       -> {"id": 3, "path": "/tmp/z.wav"}   (WAV; "engine" defaults to "edge")
  {"id": 3, "cmd": "ping"}                                            -> {"id": 3}
  any failure                                                          -> {"id": n, "error": "..."}
"""
import asyncio
import json
import os
import sys
import threading
from pathlib import Path

import edge_tts
from faster_whisper import WhisperModel

MODEL = os.environ.get("CERIMONIAS_WHISPER_MODEL", "small")
PROMPT = "Pré-daily. Issue, MR, merge request, pipeline, draft, code review, Gate, Plan, spec, hub-whatsapp, new-agent, sz4."

HERE = Path(__file__).resolve().parent
# CERIMONIAS_KOKORO_DIR wins; the hermes-poc checkout is a dev convenience for this machine.
KOKORO_DIRS = [d for d in (os.environ.get("CERIMONIAS_KOKORO_DIR"), HERE / "models", Path.home() / "projects/hermes-poc/vendor/kokoro") if d]

_model = None
_kokoro = None
_model_lock = threading.Lock()
_kokoro_lock = threading.Lock()  # loads the model once and runs one synthesis at a time (the onnx session is shared)
_out_lock = threading.Lock()


def model():
    global _model
    with _model_lock:
        if _model is None:
            _model = WhisperModel(MODEL, device="cpu", compute_type="int8")
        return _model


def kokoro():
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro

        for d in map(Path, KOKORO_DIRS):
            if (d / "kokoro-v1.0.onnx").exists() and (d / "voices-v1.0.bin").exists():
                _kokoro = Kokoro(str(d / "kokoro-v1.0.onnx"), str(d / "voices-v1.0.bin"))
                break
        else:
            raise FileNotFoundError(f"kokoro models not found in: {', '.join(map(str, KOKORO_DIRS))} (see README)")
    return _kokoro


def reply(obj):
    with _out_lock:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def stt(req):
    segments, _ = model().transcribe(req["path"], language="pt", initial_prompt=PROMPT, vad_filter=True, beam_size=1)
    return {"text": " ".join(s.text.strip() for s in segments).strip()}


def tts_kokoro(req):
    import soundfile

    with _kokoro_lock:
        audio, rate = kokoro().create(req["text"], voice=req["voice"], speed=float(req.get("speed", 1.0)), lang="pt-br")
    soundfile.write(req["out"], audio, rate)
    return {"path": req["out"]}


def tts(req):
    if req.get("engine", "edge") == "kokoro":
        return tts_kokoro(req)
    comm = edge_tts.Communicate(req["text"], req["voice"], rate=req.get("rate", "+0%"), pitch=req.get("pitch", "+0Hz"))
    asyncio.run(comm.save(req["out"]))
    return {"path": req["out"]}


def handle(line):
    req = {}
    try:
        req = json.loads(line)
        result = {"stt": stt, "tts": tts, "ping": lambda _req: {}}[req["cmd"]](req)
        reply({"id": req["id"], **result})
    except Exception as e:  # noqa: BLE001 - every failure goes back to the caller
        reply({"id": req.get("id"), "error": f"{type(e).__name__}: {e}"})


def main():
    threading.Thread(target=model, daemon=True).start()
    reply({"id": 0, "ready": True})
    for line in sys.stdin:
        if line.strip():
            threading.Thread(target=handle, args=(line,), daemon=True).start()


if __name__ == "__main__":
    main()

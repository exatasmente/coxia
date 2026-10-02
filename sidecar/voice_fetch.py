"""Downloads a faster-whisper model into the Hugging Face cache and reports progress, one JSON object per line on stdout.

  python voice_fetch.py small
  {"phase": "start", "total": 484000000}
  {"phase": "progress", "done": 1234, "total": 484000000}
  {"phase": "done", "path": "/.../snapshots/<rev>"}
  {"phase": "error", "error": "..."}

Resumable: huggingface_hub keeps partial files (*.incomplete) and continues them on the next run, so a cancelled download loses nothing.
HF_HOME says where the cache lives; the app points it at its own folder, so removing the voice setup removes the model too.
"""
import fnmatch
import json
import sys
import threading
from pathlib import Path

PATTERNS = ["config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.*"]


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def expected_bytes(repo):
    import huggingface_hub

    info = huggingface_hub.HfApi().model_info(repo, files_metadata=True)
    return sum(s.size or 0 for s in info.siblings if any(fnmatch.fnmatch(s.rfilename, p) for p in PATTERNS))


def cached_bytes(cache):
    blobs = cache / "blobs"
    if not blobs.is_dir():
        return 0
    return sum(f.stat().st_size for f in blobs.iterdir() if f.is_file())


def main(argv):
    name = argv[1] if len(argv) > 1 else "small"
    try:
        import huggingface_hub
        from faster_whisper.utils import _MODELS, download_model

        repo = _MODELS.get(name, name)
        cache = Path(huggingface_hub.constants.HF_HUB_CACHE) / ("models--" + repo.replace("/", "--"))
        try:
            local = download_model(name, local_files_only=True)
            emit({"phase": "done", "path": local})
            return 0
        except Exception:  # noqa: BLE001 - not downloaded yet: go on to fetch it
            pass
        try:
            total = expected_bytes(repo)
        except Exception:  # noqa: BLE001 - offline sizes are a nicety, the download itself reports the real error
            total = None
        emit({"phase": "start", "total": total})
        stop = threading.Event()

        def watch():
            while not stop.wait(0.5):
                emit({"phase": "progress", "done": cached_bytes(cache), "total": total})

        threading.Thread(target=watch, daemon=True).start()
        try:
            path = download_model(name)
        finally:
            stop.set()
        emit({"phase": "done", "path": path})
        return 0
    except Exception as e:  # noqa: BLE001 - every failure goes back to the caller
        emit({"phase": "error", "error": f"{type(e).__name__}: {e}"})
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))

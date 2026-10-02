"""Downloads a faster-whisper model into the Hugging Face cache and reports progress, one JSON object per line on stdout.

  python voice_fetch.py small
  {"phase": "start", "total": 484000000}
  {"phase": "progress", "done": 1234, "total": 484000000}
  {"phase": "done", "path": "/.../snapshots/<rev>"}
  {"phase": "error", "error": "..."}

Resumable: huggingface_hub keeps partial files (*.incomplete) and continues them on the next run, so a cancelled download loses nothing.
HF_HOME says where the cache lives; the app points it at its own folder, so removing the voice setup removes the model too.
Progress is the growth of that folder while the download runs: it does not depend on how huggingface_hub fetches (plain HTTP or xet).
"""
import fnmatch
import json
import os
import sys
import threading

# What faster-whisper itself downloads for a model (faster_whisper.utils.download_model).
PATTERNS = ["config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.*"]


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def expected_bytes(repo):
    import huggingface_hub

    info = huggingface_hub.HfApi().model_info(repo, files_metadata=True)
    return sum(s.size or 0 for s in info.siblings if any(fnmatch.fnmatch(s.rfilename, p) for p in PATTERNS))


def folder_bytes(root):
    total = 0
    for base, _dirs, files in os.walk(root):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(base, name))
            except OSError:
                pass  # a partial file was renamed under us
    return total


def main(argv):
    name = argv[1] if len(argv) > 1 else "small"
    try:
        import huggingface_hub
        from faster_whisper.utils import _MODELS, download_model

        repo = _MODELS.get(name, name)
        try:
            emit({"phase": "done", "path": download_model(name, local_files_only=True)})
            return 0
        except Exception:  # noqa: BLE001 - not downloaded yet: go on to fetch it
            pass
        try:
            total = expected_bytes(repo)
        except Exception:  # noqa: BLE001 - the size is a nicety, the download itself reports the real error
            total = None
        home = os.environ.get("HF_HOME") or os.path.expanduser("~/.cache/huggingface")
        start = folder_bytes(home)
        emit({"phase": "start", "total": total})
        stop = threading.Event()

        def watch():
            while not stop.wait(0.5):
                grown = max(0, folder_bytes(home) - start)
                emit({"phase": "progress", "done": min(grown, total - 1) if total else grown, "total": total})

        threading.Thread(target=watch, daemon=True).start()
        try:
            path = huggingface_hub.snapshot_download(repo, allow_patterns=PATTERNS)
        finally:
            stop.set()
        emit({"phase": "progress", "done": total or 0, "total": total})
        emit({"phase": "done", "path": path})
        return 0
    except Exception as e:  # noqa: BLE001 - every failure goes back to the caller
        emit({"phase": "error", "error": f"{type(e).__name__}: {e}"})
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))

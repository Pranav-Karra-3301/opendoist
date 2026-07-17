# Ramble — voice capture → tasks

Ramble turns a spoken voice note into structured OpenDoist tasks. You hold a mic
button in Quick Add, the audio is transcribed by a pluggable speech-to-text (STT)
provider, an optional LLM splits the transcript into discrete task drafts, and you
review and edit those drafts before they become real tasks.

Both the STT provider and the LLM are **pluggable and self-hostable** — you can run
everything locally with no API keys, use hosted providers, or mix the two (local
Whisper for transcription + a hosted model for extraction, or vice versa).

- [How Ramble works](#how-ramble-works)
- [Configuration](#configuration)
- [Provider matrix](#provider-matrix)
- [Self-hosted STT: Speaches](#self-hosted-stt-speaches)
- [Self-hosted STT: whisper.cpp server](#self-hosted-stt-whispercpp-server)
- [LLM task extraction](#llm-task-extraction)
- [Troubleshooting](#troubleshooting)

## How Ramble works

The pipeline is a five-stage status machine. Each stage moves the ramble to the next
status; a failure at any processing stage lands on `failed` and is retryable without
re-recording.

```text
[1] record      hold-to-record in Quick Add (MediaRecorder: webm/opus, m4a fallback)
[2] upload      multipart POST /api/v1/rambles                       -> status: uploaded
[3] transcribe  the STT provider turns the audio into text           -> status: transcribed
[4] extract     an LLM (optional) splits the transcript into drafts  -> status: extracted
[5] confirm     you review/edit the drafts and save real tasks       -> status: confirmed
```

**What is stored where**

- **Audio** is written to `<DATA_DIR>/rambles/<id>.<ext>` (`webm` or `m4a`, occasionally
  `mp3`/`wav`) on upload. It is **deleted the moment you confirm or discard** the ramble —
  audio is transient capture state, never a long-lived artifact.
- **Everything else lives on the `rambles` row** in the SQLite database: the status, the
  `transcript`, the extracted task drafts (JSON), and any error text. These survive after
  confirmation (the audio is gone, the text stays), so a failed extraction is retryable
  without re-recording.

**Statuses**

| Status | Meaning |
|---|---|
| `uploaded` | Audio received and stored; transcription not started yet. |
| `transcribed` | STT produced a transcript. |
| `extracted` | Task drafts are ready for review (the `none` extractor also lands here). |
| `confirmed` | You saved the drafts; real tasks were created and the audio was deleted. |
| `failed` | A stage errored. `failedStage` is `transcribe` or `extract`; `error` holds the message. |

**Per-stage retry.** Each processing stage has its own idempotent endpoint, so after a
`failed` you fix the config and re-run just that stage:

- `POST /api/v1/rambles/:id/transcribe` — re-run STT (valid from `uploaded` or a failed transcribe).
- `POST /api/v1/rambles/:id/extract` — re-run extraction (valid from `transcribed`, `extracted`, or a failed extract).

In the web app these are the **Retry** button on the review dialog; it re-posts whichever
stage failed.

## Configuration

Ramble reads two independent provider "slots" — STT and LLM — from environment variables.
These are **instance defaults**; each user can override the whole slot from
**Settings → Integrations** (see the note below).

| Variable | Values / example | Notes |
|---|---|---|
| `OPENDOIST_STT_PROVIDER` | `openai-compatible` · `deepgram` · `elevenlabs` | Selects the STT adapter. **Unset = Ramble disabled** — uploads are rejected with a `409`. |
| `OPENDOIST_STT_BASE_URL` | `https://api.openai.com/v1` | API base URL. For `openai-compatible` the adapter appends `/audio/transcriptions`, so include the `/v1` segment. Leave unset for `deepgram`/`elevenlabs` to use their default hosts. |
| `OPENDOIST_STT_MODEL` | `gpt-4o-mini-transcribe` | Model id. Defaults per provider — see the [matrix](#provider-matrix). |
| `OPENDOIST_STT_API_KEY` | `sk-...` | API key. **Optional for local sidecars** (Speaches / whisper.cpp need none). |
| `OPENDOIST_LLM_PROVIDER` | `openai-compatible` · `none` | Task extraction. `none` (or unset) = one task per ramble with the transcript in its description. |
| `OPENDOIST_LLM_BASE_URL` | `https://api.openai.com/v1` | API base URL. The adapter appends `/chat/completions`, so include the `/v1` segment. |
| `OPENDOIST_LLM_MODEL` | `gpt-4o-mini` | Chat model id. |
| `OPENDOIST_LLM_API_KEY` | `sk-...` | API key. **Optional for local runtimes** (e.g. Ollama needs none). |

A minimal hosted-OpenAI setup for both slots:

```bash
OPENDOIST_STT_PROVIDER=openai-compatible
OPENDOIST_STT_MODEL=gpt-4o-mini-transcribe
OPENDOIST_STT_API_KEY=sk-...
OPENDOIST_LLM_PROVIDER=openai-compatible
OPENDOIST_LLM_MODEL=gpt-4o-mini
OPENDOIST_LLM_API_KEY=sk-...
# OPENDOIST_STT_BASE_URL / OPENDOIST_LLM_BASE_URL default to https://api.openai.com/v1
```

**Per-user overrides & key storage.** Any user can override a whole slot in
**Settings → Integrations**. Overriding is slot-level, not field-level: a user row with a
provider set replaces the entire env slot (provider + base URL + model + key) — env fields
do not leak through. API keys entered in Settings are **encrypted with AES-256-GCM** before
being written to the database; the encryption key is generated once into
`<DATA_DIR>/secrets.json` on first boot and never leaves the server. Keys are never sent
back to the browser — the UI only reports whether a key is set.

## Provider matrix

The `openai-compatible` adapter is the primary one: a single implementation covers OpenAI,
Speaches, whisper.cpp, and other OpenAI-shaped endpoints (Groq, LocalAI, …) purely by
changing the base URL and model. Deepgram and ElevenLabs are thin extra adapters.

| Provider | `OPENDOIST_STT_PROVIDER` | Default model | Price ballpark | API key |
|---|---|---|---|---|
| OpenAI | `openai-compatible` | `gpt-4o-mini-transcribe` | ~$0.003/min | required |
| Deepgram | `deepgram` | `nova-3` | ~$0.0043/min (batch, EN); $200 free credit | required |
| ElevenLabs | `elevenlabs` | `scribe_v1` | ~$0.0037/min (~$0.22/hr) | required |
| Speaches (self-hosted) | `openai-compatible` | `Systran/faster-whisper-small` | free (your hardware) | **none** |
| whisper.cpp server (self-hosted) | `openai-compatible` | chosen by `-m` at launch | free (your hardware) | **none** |

Prices are ballparks (verified mid-2026) and change; treat them as orders of magnitude. A
one-to-two-minute ramble costs a fraction of a cent on any hosted option, or nothing on a
local sidecar.

## Self-hosted STT: Speaches

[Speaches](https://speaches.ai/) (formerly faster-whisper-server) exposes an
OpenAI-compatible `/v1/audio/transcriptions` endpoint and downloads Whisper models from
Hugging Face on demand. It is the easiest local STT to run alongside OpenDoist.

Add it to your Compose file as a sidecar. Because both services live in the same Compose
project they share the default network, so OpenDoist reaches Speaches at the `speaches`
hostname:

```yaml
services:
  opendoist:
    image: ghcr.io/pranav-karra-3301/opendoist
    ports:
      - '7968:7968'
    volumes:
      - ./data:/data
    environment:
      OPENDOIST_STT_PROVIDER: openai-compatible
      OPENDOIST_STT_BASE_URL: http://speaches:8000/v1
      OPENDOIST_STT_MODEL: Systran/faster-whisper-small
    depends_on:
      - speaches

  speaches:
    image: ghcr.io/speaches-ai/speaches:latest-cpu # or :latest-cuda with a GPU
    ports:
      - '8000:8000'
    volumes:
      - hf-hub-cache:/home/ubuntu/.cache/huggingface/hub

volumes:
  hf-hub-cache:
```

The three lines that point OpenDoist at the sidecar (already inline above; shown here for a
plain `.env`):

```bash
OPENDOIST_STT_PROVIDER=openai-compatible
OPENDOIST_STT_BASE_URL=http://speaches:8000/v1
OPENDOIST_STT_MODEL=Systran/faster-whisper-small
# no OPENDOIST_STT_API_KEY — the local sidecar needs no key
```

Smoke-test the sidecar directly (this is the same request the `openai-compatible` adapter
makes):

```bash
curl http://localhost:8000/v1/audio/transcriptions \
  -F file=@ramble.webm \
  -F model=Systran/faster-whisper-small \
  -F response_format=json
# -> {"text": "..."}
```

## Self-hosted STT: whisper.cpp server

[whisper.cpp](https://github.com/ggml-org/whisper.cpp) ships a single-binary server with no
Python dependency. Run it with an OpenAI-style route so the `openai-compatible` adapter can
talk to it unchanged:

```bash
./build/bin/whisper-server -m models/ggml-base.en.bin --host 0.0.0.0 --port 8080 --convert \
  --inference-path /v1/audio/transcriptions   # mimic the OpenAI route
```

Point OpenDoist at it:

```bash
OPENDOIST_STT_PROVIDER=openai-compatible
OPENDOIST_STT_BASE_URL=http://whisper:8080/v1
OPENDOIST_STT_MODEL=whisper-1
# whisper.cpp ignores the model field (the model is fixed by -m at launch),
# but OpenDoist always sends one — any non-empty value works.
```

**`--convert` requires ffmpeg** inside that container. whisper.cpp natively wants WAV; the
`--convert` flag uses ffmpeg to transcode the incoming `webm/opus` or `m4a` recordings to
WAV on the fly. Without ffmpeg (or without `--convert`), non-WAV uploads fail.

## LLM task extraction

When an LLM slot is configured, OpenDoist sends the transcript to a `/chat/completions`
endpoint and asks for a **strict JSON-schema** response of the shape
`{ "tasks": [{ "title", "notes", "due", "priority", "labels" }] }`. Key behaviors:

- **The LLM never invents dates.** `due` is kept as the *spoken phrase* exactly
  (`"tomorrow 5pm"`, `"every friday"`). OpenDoist parses it with its own date/recurrence
  engine at confirm time, so time zones and relative dates are always resolved by the same
  code that powers Quick Add.
- **Priority** follows OpenDoist's convention: `1` = highest … `4` = default; the model is
  told to set one only when the speaker signals urgency, else `null` (which becomes `4`).
- **Labels** are constrained to your existing label names.
- **Empty is valid.** If nothing actionable was said, the model may return zero tasks.

**Validation + one retry.** The response is validated with zod. On invalid or
schema-violating JSON the request is re-sent **once** with the validation error appended; a
second failure marks the extract stage `failed` (retryable). This matters for local models
(e.g. Ollama's `llama3.1:8b`), whose strict-schema adherence is weaker than hosted models.

**`none` fallback.** With no LLM provider — `OPENDOIST_LLM_PROVIDER=none` or simply unset —
extraction is skipped and the ramble becomes a **single task**: the title is the first line
of the transcript (truncated at a word boundary), the full transcript goes in the
description. This path never fails; you still get to review before saving.

**Local LLM example (Ollama).** Ollama exposes an OpenAI-compatible API at `/v1`, so it
drops into the same adapter:

```bash
OPENDOIST_LLM_PROVIDER=openai-compatible
OPENDOIST_LLM_BASE_URL=http://ollama:11434/v1
OPENDOIST_LLM_MODEL=llama3.1:8b
# no OPENDOIST_LLM_API_KEY — Ollama needs no key
```

## Troubleshooting

**`409` on upload / "No speech-to-text provider is configured".** No STT slot is set. Set
`OPENDOIST_STT_PROVIDER` (plus base URL / model / key as needed), or configure it per-user
in **Settings → Integrations**. In the web app the mic button is disabled with this tooltip
until an STT provider exists.

**The ramble shows `failed` with an error message.** The `error` text on the row (and in the
review dialog) tells you what went wrong — a bad or missing API key, an unreachable base
URL, or a provider-side error. `failedStage` tells you whether it was `transcribe` or
`extract`. Fix the provider config, then press **Retry** (or POST the matching stage
endpoint); the audio and transcript are still on the row, so you never re-record.

**`413` on upload.** The recording exceeds `OPENDOIST_UPLOAD_MAX_MB` (default `25`). Increase
that limit or record a shorter note. At ~0.36 MB/min for Opus, 25 MB is roughly an hour.

**Microphone permission.** The browser must grant microphone access, and recording requires
a **secure context** (HTTPS, or `localhost` in development). If you denied the prompt,
re-enable the microphone for the site in the browser's permission settings and reload.

**iOS / PWA recording format.** OpenDoist records `audio/webm;codecs=opus` where supported —
including iOS Safari since **18.4 (March 2025)** — and falls back to `audio/mp4` (AAC) on
older iOS. Both formats are accepted server-side and by every provider above; no
transcoding happens in the browser.

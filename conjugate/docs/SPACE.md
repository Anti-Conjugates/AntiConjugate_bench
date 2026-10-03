# Hugging Face Space

Live Space: https://huggingface.co/spaces/Ryukijano/conjugate (Docker, cpu-upgrade hardware, sleeps after one idle hour). Direct app URL: https://ryukijano-conjugate.hf.space

The repository `Dockerfile` builds the whole app into one image that serves the built UI and the API on port 7860. It runs in rules only mode unless `ANTHROPIC_API_KEY` is set as a Space secret. The key is read by the server process only and never reaches the browser bundle, traces or exports.

## Publish

1. Create a Docker Space under your user or organisation.
2. The repository `README.md` already starts with the Space front matter Hugging Face reads:

```yaml
---
title: Conjugate
emoji: 🔬
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: mit
---
```

3. Push the repository to the Space remote. Hugging Face rejects pushes with binary files outside Git LFS; the repository tracks `*.jpg` and `*.png` (the pstack guide images) with LFS for that reason. Docker Spaces on free hardware need a PRO subscription; paid hardware such as `cpu-upgrade` works without one. `.dockerignore` already excludes `node_modules`, build output, `.env` files and the Modal virtual environment.
4. Optional: add `ANTHROPIC_API_KEY` under Settings, Variables and secrets. Restart the Space afterwards. Without it the Claude option is disabled in the UI and the API returns `CLAUDE_NOT_CONFIGURED`.

## Check before posting

```sh
docker build -t conjugate-space .
docker run --rm -p 7860:7860 conjugate-space
curl http://127.0.0.1:7860/api/health
```

Expected: `{"status":"ok","claude_configured":false,"model":"claude-opus-5-5"}`. Run one Check a claim in the UI and open Evals.

## What the Space is and is not

- It demonstrates claim checking against an imported workbook and dated label summaries, with an independent verifier and software evals.
- It is a research prototype. Every result is a draft pending pharmacist review with the clinical gate blocked.
- The Evals page shows software checks on the verifier. They are not a clinical benchmark and not proof of calibration or resistance to every way a model could game the system.
- The antibody sequence map is exploratory ESM-2 structure data and says nothing about binding, efficacy or safety.

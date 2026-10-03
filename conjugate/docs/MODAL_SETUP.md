# Modal remote-worker setup

## Scope

Install the SDK in an isolated Python environment, authenticate with Modal, then run the user's CPU-only `square.remote(42)` example. This is not a HER2 deployment, Hugging Face connection or model inference job. No GPU or public endpoint is configured. The Node/React application is unchanged.

## Reproduce locally

Python 3.10+; from the project root:

```sh
python3 -m venv .venv-modal
source .venv-modal/bin/activate
python3 -m pip install -r requirements-modal.txt
python3 -m modal setup
python3 -m modal run scripts/modal_example.py
```

Activate the environment in each new shell, or use `.venv-modal/bin/python` directly. Commands above use POSIX shell syntax. The example's local entrypoint invokes the square function on a remote Modal worker; it is not triggered by running plain `python scripts/modal_example.py`.

`modal setup` normally opens a sign-in flow. The user can complete that flow manually; no browser automation is needed. Modal stores its token in the user's home-directory configuration, outside this project. Alternatively provide `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` through secure environment injection; never put them in source, frontend fields, chat or the source archive.

`modal run` creates an ephemeral cloud app, not a persistent `modal deploy`. It uses Modal account compute/credits. For this example the expected printed result is `the square is 1764`; that expected result is not evidence that the remote call actually completed.

## Local verification without credentials

```sh
python3 -m pip install -r requirements-modal-dev.txt
python3 -m ruff check scripts/modal_example.py
python3 -m mypy --strict scripts/modal_example.py
python3 -m pip check
```

Installation (Modal 1.5.5), import/app registration, lint, strict Python types, dependency compatibility and local arithmetic were verified. Existing app tests/typechecks/lint still pass. The SDK authentication flow was started without launching a browser; it is waiting for manual authorization. Authentication and the actual remote invocation are separate steps and are not verified yet. There were no configured Modal credentials when setup started.

## Future model workers

Once the remote plumbing is verified, choose an exact model repository, revision, task, dependencies and CPU/GPU requirements before adding model inference. Do not call the arithmetic worker a scientific model or send real patient information. Retain the boundaries in `INTEGRATIONS.md` and `AGENTS.md`.

## Official references

- https://modal.com/docs/guide
- https://modal.com/docs/examples/hello_world
- https://modal.com/docs/reference/cli/setup
- https://modal.com/docs/reference/modal.config
- https://modal.com/docs/guide/apps

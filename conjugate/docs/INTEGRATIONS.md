# User-managed Hugging Face and Google Antigravity connections

The user explicitly ruled out browser automation and intends to connect Hugging Face and Google Antigravity skills. No browser driver, screen recording or UI-testing agent is part of this prototype. The user can inspect the live app manually.

## Current connection state

| Integration | State | Responsibility |
|---|---|---|
| Deterministic evidence mode | Implemented, no external model call | Application |
| Anthropic Claude Opus 5.5 | Server adapter implemented; live access unverified without replacement key | Application + user credentials |
| Hugging Face | Not connected; exact model/revision/output contract not selected | User |
| Google Antigravity skills | Not connected or executed here | User |
| ADCdb | Two exact structural references; no live model/data fetch during runs | Local allowlist |

## Keep engineering tools separate from scientific outputs

An IDE/engineering skill is not automatically an API service, a validated model prediction or a clinical evidence source. If an Antigravity skill calls a Hugging Face model, the output must retain the identity and provenance of the actual model and data. Never report the skill's existence as proof that a model ran.

## Connection contract to agree before adding an adapter

For each model output, retain provider/repository ID, pinned revision, model task, input representation and units, invocation date, method/tool versions, limitations, and any applicable source/reference IDs. Keys remain server-side and are never sent through engineering-agent prompts.

Keep predictive/structural observations in a **separate research evidence layer**, explicitly `UNVERIFIED` until primary evidence and expert interpretation are checked. Do not turn affinity, DAR, linker stability, embeddings or structure predictions into an individual clinical-risk probability, treatment eligibility or dosage.

For a future drafting provider, implement a server-side adapter with a declared engine/model, shared request/response schema, bounded identifier-only output and sanitized errors. Do not relabel a Hugging Face response as Claude or use the existing Claude engine field for unrelated predictions. Configuration, mocked tests and a successful live call are separate states.

The independent guardrail must still reject unknown/cross-product/source-mismatched IDs and report omissions without repairing the model draft. All derived clinical content remains pharmacist-unapproved; all cards remain human-required and blocked for clinical release. Do not give a model or skill access to the independent clinical benchmark, answer keys or scoring script.

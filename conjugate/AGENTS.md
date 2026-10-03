# HER2 engineering boundaries

Use the project-local `pstack-her2` adaptation; start with its HER2 workflow and shared contracts.
The Cursor plugin is an engineering workflow, not the runtime clinical agent. The runtime uses `claude-opus-5-5` only when explicitly configured, otherwise labelled deterministic evidence mode.

All clinical content is draft pending pharmacist approval. Synthetic inputs only. No names, identifiers, EHRs, persistent clinical storage, prescribing doses, treatment-selection recommendations or claims of clinical validation.
Agents must not create/access/change the independent clinical benchmark, clinician cases, answer keys or scoring scripts. Software unit tests of contracts, API errors and safety enforcement are allowed; these are not clinical benchmarks.
No inferred affinity windows, calibrated confidence or omission probabilities. Probabilities remain null. All outputs require human review and are blocked from clinical release pending approval.
Validate data at boundaries. Derive client and server types from `packages/shared`. Allowlist source IDs and product-specific evidence. Keep Claude keys server-side; never put secrets in Vite env, git, traces, exports or logs. Do not silently fall back after a Claude failure.
Preserve MIT attribution for pstack. Do not use unavailable Cursor tools or default model aliases as though they ran here. Do not merge, publish or post externally without user instruction.

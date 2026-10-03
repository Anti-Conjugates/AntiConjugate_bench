# pstack → HER2 research

Forked from cursor/plugins/pstack version 0.15.6 under its MIT license. Original copyright and LICENSE are retained. Upstream repository: https://github.com/cursor/plugins/tree/main/pstack.

## Changes
- Distinct plugin identity `pstack-her2` / version `0.15.6-her2.1`.
- HER2 workflow and evidence-review skills, pharmacist-review rules and bounded research agent.
- Project override in Poteto Mode and Poteto Agent makes the clinical, secret and benchmark boundaries higher priority than upstream autonomy/shipping guidance.
- Engineering-agent model choices are not clinical runtime choices. App model is Claude Opus 5.5; deterministic fallback must be explicitly labelled evidence-only.
- Directory ownership separates the shared contract, backend, frontend and independent reviewer. The reviewer reads both writer outputs only after the barrier.

## Use
Install the local `pstack-her2` directory as a Cursor plugin (manifest: `.cursor-plugin/plugin.json`) using your supported Cursor local-plugin installation workflow, or open this project and follow root `AGENTS.md`. Invoke `/her2-workflow` before building across evidence, drafting, guardrails or UI. Invoke `/her2-evidence-review` before changing a source or flag. The local fork's installation in Cursor has not been tested here.

In Devin the preserved Cursor tools are not directly available. This build used a supported three-agent workflow instead: two scoped writers and a read-only integration reviewer on the shared VM because there is no project remote. See `docs/ARCHITECTURE.md` for the actual boundaries. Never pretend unavailable Cursor models/tools ran.

## Applied pstack principles
Model the Domain: shared Zod contracts and exact product/source registries precede logic.
Prove It Works: software tests, listening API probes and build results are separate from clinical or browser validation. Unexecuted checks remain explicitly untested.

No benchmark result, calibrated probability, clinical validation, dosing recommendation or treatment-selection decision is supplied by this plugin.

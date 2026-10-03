---
name: plain-copy
description: Write UI text, docs, Space pages and posts for Conjugate in plain, specific language. Use for any user-facing text in this repo. Builds on unslop.
---

# Plain copy

Apply `unslop` first. Then apply these project rules.

## Say the safety boundary once

The app is a research tool. Clinical release is always blocked and a pharmacist must review anything clinical. Say this once per screen, in one short banner or footer line. Do not repeat it in every label, empty state and tooltip.

Bad: "Imported text only. Not interpreted as advice, current regulatory approval or clinical risk."
Good: "Raw text from the workbook. Not checked."

## Lead with what the user sees or can do

Headings name the thing on screen. Body text tells the user what it is or what to do next.

Bad: "Validated evidence dossier", "Immutable workbook / structural exploration", "Bounded hypothesis library".
Good: "Result", "ADC table", "Questions".

## One negation per sentence, at most

Long chains of "not X, not Y, never Z" read as legal hedging. Pick the one limit that matters for that spot.

Bad: "Not a hidden benchmark, clinical evaluation or measured reward-hacking score."
Good: "Injects a bad citation to check that the verifier rejects it."

## Banned in UI copy

immutable, bounded, dossier, epistemic, protocol (as a page or heading), orchestration, actual server trace, no progress is simulated, robust, seamless, cutting-edge, empower, unlock, leverage, journey, holistic, slash-separated eyebrow labels ("02 / ..."), numbered section prefixes.

## Words to use consistently

- "claim" for a statement being checked. Verdicts are "supported", "contradicted", "not enough evidence".
- "source" for a workbook row, label summary or derived note. Not "receipt" in UI text (the code type can stay).
- "check" for a verifier test. "Fault test" for an integrity drill in the UI.
- "Kadcyla (trastuzumab emtansine)" and "Enhertu (trastuzumab deruxtecan)" on first mention, brand name after.

## Empty and error states

State what happened and the next step, in under 15 words. "Couldn't load the catalog. Check the API is running on :3001."

## Posts and Space pages

- Open with what you built and one concrete result with a number.
- Name models, data and sizes exactly: "31 ADCs from ADCdb", "claude-opus-5-5", "ESM-2 650M".
- State limits plainly near the end. No hype words, no emoji walls, no "game-changer".
- Every number must come from a file in the repo (eval results, snapshot). Do not round up or extrapolate.

# Research chat

## Why this shape

The chat is an evidence-auditing interface, not a general scientific or medical chatbot. Three independent design reviews covered the Claude API, the judge demo, and adversarial software checks. The implementation takes their common recommendations: finite scopes, no raw transcript sent to Claude, actual native tools, independent verification, explicit omissions, and no hidden fallback.

We deliberately use one consolidated `check_evidence` tool rather than exposing files or individual readers to Claude. Each admitted call runs the existing deterministic research pipeline. Claude chooses checks and selects returned audit IDs; it does not produce claim prose, assign verdicts or choose citations. This is a coordination task on fixed records, not independent literature discovery. A rules-only baseline can perform the same checks without a model.

```text
Synthetic question + previous scope hints
                |
Local scope gate: two products, five questions, two source policies
                |
         +------+------+
         |             |
   Rules-only      Claude Messages API
   controller      native check_evidence calls
         |             |
         +------+------+
                |
Frozen local sources -> unchanged independent verifier
                |
Audit IDs, trusted claims, receipts, limits -> Claude (if enabled)
                |
Identifier-only final selection -> controller-rendered answer
                |
Strict client validation -> per-turn claims, sources, omissions, export
```

## Request and scope

`POST /api/chat/turns` returns JSON; `/api/chat/turns/stream` returns NDJSON completed events and exactly one terminal result or sanitized error. A strict shared request contains `message`, `engine`, `context` (at most four product/question/policy hints), and `synthetic_confirmed: true`. Text is at most 1,000 characters. There is no history service, database, conversation upload, browser tool, live retrieval or automatic request on page load.

The local recognizer supports composition, linker-release inference, payload-risk transfer, workbook safety claims, and US identity fields. It understands product aliases, a small research vocabulary, and source-policy follow-ups. It is intentionally incomplete: the displayed recognized scope is narrower than arbitrary natural language. Unknown words are removed from provider input. Clinical/patient-like or credential-like patterns stop the turn before Claude. This guard is not a PHI detector or a de-identification guarantee. Do not submit personal information.

Client context cannot supply prior results, citations or instructions. Each turn starts a fresh provider conversation using recognized terms and scope IDs. The provider never receives earlier answers. Withholding applies to UK summaries, US identity records and derived notes, not just a citation display filter.

## Claude loop and prompt packs

The server calls `claude-opus-5-5` with adaptive thinking, low effort, a fixed tool definition and a fixed JSON output schema. Only messages are appended during continuation; system/tool/schema prefixes do not change. Returned thinking blocks stay in request memory for signed continuation and are never displayed or exported.

The reviewed local evidence-retrieval, counter-evidence and provenance-review `SKILL.md` packs are verified and hashed before use. These are prompt packs, not Anthropic-hosted Skills uploads or code-execution containers. pstack remains the engineering workflow, not a runtime clinical agent.

All calls in one native batch are validated before any executes. Arguments can contain only an authorized product and question. Source policy is server-bound. Duplicate IDs, duplicate scopes, unknown tools and extra arguments fail closed. Tool results contain checked findings, audit IDs and source IDs. Final output can contain only distinct returned audit IDs. Free prose, invented IDs, unsupported stop reasons, refusal, timeout and budget exhaustion release no answer. Completion without a successful audit is a failure, not evidence-based abstention.

Accepted but unselected audits are visible as omitted checks. An accepted insufficient-evidence claim is different from an omission or provider failure. The UI does not hide these states behind one badge.

## Limits and cost

One turn has one 60-second deadline, at most four attempted provider calls, four deterministic audits, sixteen source reads, zero retries, 65,536 provider-request bytes, 131,072 provider-response bytes, and 4,096 output tokens per model call including thinking. JSON/NDJSON routes share a two-active-question limit per server instance. Existing IP rate limits remain in effect. Disconnect and Cancel abort further work; they do not prove provider billing stopped.

The UI caps a conversation at eight turns and has a synchronous submission lock and stale-request epochs. That client cap is a usability limit, not authorization or a spend cap for direct API clients. Claude stays disabled on the public Space; enabling it publicly requires a separate approval and access/spend design.

The application saves no chat history and logs no request/model/source content. This does not establish zero retention by a cloud provider, proxy or the user's browser. Each provider call still follows the account's Anthropic retention terms.

## What a checked result means

Each answer is rendered from fixed server statements and verified source bindings. Source hashes shown in the browser are server-reported, not client-established proof of scientific truth or authenticated execution. UK summaries are paraphrases pending pharmacist approval. Workbook values are unverified. openFDA provides frozen identity only. Derived rows cannot support primary claims.

All results keep draft-pending-pharmacist status, eligibility not assessed, human review required, clinical release blocked, and null correctness/omission probabilities.

## Reproduce and check

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run smoke
npm run eval:chat
npm run eval:chat -- --live # paid, at most 16 provider calls; no retries
npm run replay:chat -- exported-turn.json
```

Replay checks the saved audits against local snapshots and verifier output, controller reply and follow-ups, displayed audit fields and trace wording, code fingerprint, skills and call/source consistency. It re-executes local deterministic audits, never Claude. UUIDs, timestamps and durations are not authenticated or reproduced. It does not reconstruct raw intent from a hash or establish clinical correctness. Browser automation is excluded.

Negated restoration keeps evidence withheld; conflicting policy commands ask for clarification. Contextual comparisons retain the previous question. Explicit combinations of supported questions are retained up to the four-check limit rather than silently dropped. After a provider failure, the latest locally recognized scope remains available for a fresh follow-up; no failed answer or prior prose is reused. The whole-turn timer also covers stalled prompt-file reads and event callbacks, and releases the server slot on cancellation or deadline.

## Three-minute path

1. Research chat: confirm synthetic-only input and ask “Compare Kadcyla and Enhertu composition.” Open the cited workbook cells.
2. Ask “Does Enhertu’s cleavable linker establish release in blood?” Read the counter-evidence, not just the badge.
3. Click “What changes with only workbook evidence?” The new result has its own sources and trace; the old label is not available to the new turn. Look for Contradicted becoming Not enough evidence.
4. Open Evals. Separate chat software controls, observed live API calls, and the older citation-selection experiment. State that rules can answer the same fixed questions.

## Official references

- [Claude tool-use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [Implement tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use)
- [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)

No source webpage is fetched during a research turn.

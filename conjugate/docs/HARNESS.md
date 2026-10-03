# Run limits and reproducibility

Conjugate uses a small controller around fixed local tools. The model selects
identifiers; the deterministic verifier owns acceptance and the displayed verdict.
Clinical release remains blocked independently of either outcome.

## Execution

- Rules-only runs make zero model calls and load no runtime prompt packs.
- Claude runs make one planner call and one draft call, with no retries.
- All work shares one 60-second deadline; cancellation aborts pending provider work.
- At most four unique local tools run: workbook, UK summary, derived notes, US identity.
- Workbook-only mode never executes the other three tools.
- The model request body is capped at 65,536 bytes; its response at 131,072 bytes.
- The planner receives permitted tool IDs. The drafter receives only retrieved
  records, reviewed prompt packs and the server-controlled expected citation mapping.
- No live evidence retrieval, arbitrary paths, executable skills or remote MCPs.
- Raw model prose and upstream errors are discarded. Clinical inputs are synthetic.

The model is given the expected citation mapping. Successful model runs therefore
measure contract-following, not independent evidence discovery or scientific truth.
Source records are data, not instructions. The verifier checks every receipt
against the trusted local record, including excerpts, dates, URLs and limitations.

## Frozen US identity records

`npm run import:openfda` fetches exactly two allowlisted brand records over HTTPS.
It caps each response at 2 MB, checks brand/generic/application fields and requires
original-packager metadata. Both records must succeed before the existing snapshot
is replaced. Only identity fields, SPL IDs, version, effective date, fetch time,
query URL, record URL and raw-response hash are saved. Raw clinical sections are
discarded; the hash is a receipt for fetched bytes, not an archived raw response.

Startup validates both product identities and exact query/record URLs. The new
`label_identity` question checks the brand, generic name and application number.
Only that question can cite this source. US identity metadata does not substitute
for the UK summary and does not verify approval, freshness or clinical suitability.

openFDA documents manufacturer-submitted, reformatted records that FDA has not
verified and that may differ from currently distributed or approved labeling.
Fetch time does not establish that a record is current. Import updates require a
reviewed diff and rerunning the checks; there is no background refresh.

## Fingerprints and replay

Research results include hashes of production API/shared source files, the two
snapshots and the lockfile; the validated request; every retrieved source; and
the exact bytes/version of each runtime prompt pack used. Object keys are sorted
before hashing requests and receipts. Array order remains significant.

```sh
npm run eval:harness
npm run replay -- exported-research-result.json
```

Replay validates the export, fingerprints, call counts and verifier outcome against
the current local code and records. It makes no model calls. It does not reproduce
model choices, timings, narrative answer text or the complete execution history.
The browser checks the manifest shape and its tool/source relationships, not the
hash contents. It labels those hashes as server-reported. Use replay for content
checks. Replay also binds receipts to allowed, unique tool executions and their
exact trusted local source IDs. Hashes are identifiers, not signatures. Someone can fabricate a manifest; replay
does not authenticate who ran a result, and it cannot establish scientific truth.
The same code and sources are required, so older exports fail after code changes.

The harness suite tests two products × five questions × two source settings:
verifier replay, limits, source withholding, eight receipt-field mutations,
duplicates, and source edits with recomputed hashes. It is a developer-authored
software suite, not an independent clinical benchmark or model-attack benchmark.
`npm run eval` separately runs citation fault tests, scripted draft strategies and,
when `ANTHROPIC_API_KEY` is set, the live Claude grid. The Evals page reads generated
artifacts; do not hand-edit their reported counts.

## Design sources

Reviewed 3 October 2026:

- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
  — simple composable patterns, clear tool interfaces, measured complexity.
- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
  — explicit state and reproducible handoffs; this app does not need a long-running loop.
- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
  — distinguish execution harnesses from evaluation harnesses and task outcomes from traces.
- [openFDA drug labeling](https://open.fda.gov/apis/drug/label/)
  and [authentication](https://open.fda.gov/apis/authentication/)
  — data caveats, HTTPS and API limits.
- [Agent Skills specification](https://agentskills.io/specification)
  — name/description metadata and progressive loading.

Development used the project’s pstack-her2 workflow and plain-copy guidance, with
reviewed tool-use/context-engineering ideas from Ryukijano/agent-skills. That broad
skill repository is not loaded by the app. Runtime prompt packs remain a separate,
three-file allowlist; pstack is an engineering workflow, not the research runtime.

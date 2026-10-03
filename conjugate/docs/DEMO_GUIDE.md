# Conjugate: a three-minute demo

## What it is

A workbench for checking claims about HER2 antibody-drug conjugates. It shows what supports a claim, what contradicts it and what is missing, without turning scientific metadata into prescribing advice. It demonstrates small local tools and an independent software verifier. It does not demonstrate calibrated uncertainty, clinical validation or measured resistance to reward hacking.

The best fit is the epistemological-agent description supplied by the organiser. The public [London AI x Science event listing](https://luma.com/3iipivod) still describes Originator as a computer-use track and does not confirm the expanded description. Confirm the final judging criteria with the organiser. Browser automation is excluded from this project.

## Demo sequence

1. Check a plausible inference. In Check a claim, pick Enhertu and the question "Does a cleavable linker mean release in blood?". Keep rules only, sources set to All, and tick the synthetic confirmation. The label summary contradicts the inference: the cleavable tetrapeptide linker is described as plasma-stable with intracellular cleavage. This says nothing about release in any one person.
2. Take the evidence away. Set sources to Workbook only and run again. The verdict changes to Not enough evidence because the label is withheld. The run cannot use another product's sources or model memory to keep its verdict. Compare the Sources used sections of the two results.
3. Show useful support. Pick "What is it made of?". The Sources used section shows the exact workbook cells for payload and DAR. Supported here means the uploaded row says this. The snapshot is unverified and the clinical gate stays blocked.
4. Break a citation. Open Fault test, pick a cross-product, derived-as-primary or invented-source fault and run. The verifier rejects the draft and the Checks table shows which code caught it. This is a software check you switched on, not a spontaneous model failure, hidden clinical test or benchmark score.
5. Show the boundary of the data. Open ADC table: 31 records, four separate derived rows and 69 blank cells. Select a record without a label summary to show that structure data alone does not unlock Patient context.

If time is short, do steps 1 and 2 and open the trace. Do not call rules only mode an LLM run.

6. Show the checks. Open Evals. The numbers come from `scripts/eval.ts` running the real pipeline: how many injected bad citations the verifier rejected, which scripted strategies it caught everywhere, the one verdict that changes when the label is withheld, and the Claude grid with timings. Say what they are: software checks on the verifier, not a clinical benchmark.

How it works shows the seven-stage pipeline, the ten verifier codes and what the app does not do. The antibody sequence map at the bottom of ADC table is exploratory ESM-2 structure data; say so if you show it.

## Claude and skills

Claude mode uses the fixed model id `claude-opus-5-5`, a server-side API key, a planner and an id-only draft. Reviewed local `runtime-skills/*/SKILL.md` files specialise retrieval, counter-evidence and provenance review. These are app-level prompt packs. Anthropic-hosted Skills uploads and code-execution containers are not enabled.

The verifier is outside the drafting model's control. No model can change the product and source mappings, the clinical gate or the independent benchmark. The trace reports the stages, actors and sources that actually ran, not a simulated activity feed.

Without a configured key, rules only is the working demo and the Claude option is disabled. A configured key is not proof of account access. Do not claim a live Claude run until one has succeeded.

## Research behind the design

| Source | Design consequence | What it does not establish |
| --- | --- | --- |
| [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents) | Prefer a small workflow with explicit tools and measurable software boundaries over unnecessary autonomy. | Validation of this app or a need for many runtime model agents. |
| [Anthropic: Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | Separate evidence gathering, drafting and checking; make tool interfaces and provenance inspectable. | Transfer of its reported benchmark improvement to this project. |
| [Reward Hacking Challenges Oversight of Autonomous Research Agents](https://arxiv.org/abs/2609.28614), September 2026 preprint | Keep evaluation metrics and data outside the agent's control and recompute results independently. Fault tests exercise specific enforcement paths. | Proven reward-hacking resistance, calibrated abstention or a clinical benchmark result here. |
| [Anthropic Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) and [authoring guidance](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | Use short, reviewed domain instructions and allowlisted resources. Keep local packs distinct from provider-hosted skills. | Uploaded skills, code-execution support or successful provider calls. |
| [ADCdb primary publication](https://pmc.ncbi.nlm.nih.gov/articles/PMC10768060/), [Enhertu SmPC](https://www.medicines.org.uk/emc/product/12135/smpc), [Kadcyla SmPC](https://www.medicines.org.uk/emc/product/5252/smpc) | Keep structure observations, product-specific label paraphrases and author-derived classifications apart. | Complete source snapshots, pharmacist approval or individual clinical safety. |

Online research guided the engineering. Runs read local reviewed registries and snapshots; they do not browse these sites live.

## Boundaries to say aloud

- No treatment selection, dosing, eligibility or acute-symptom triage.
- Clinical summaries are pending pharmacist review. Human review is mandatory.
- No numerical confidence or calibration claim. Correctness and omission probabilities are always null.
- No independent clinical benchmark, answer key or grader was created or accessed.
- Hugging Face and Antigravity are user-managed and not connected. Modal's square example is separate and unverified remotely.
- The workbook's extraction date is unknown and repeated cut-off text is a completeness limit. Its hash identifies a file, not scientific truth.

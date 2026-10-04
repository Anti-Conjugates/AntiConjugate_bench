# Component scorecard

## Scope

Linker lab is separate from the evidence checker. It compares a synthetic molecular graph, an imported antibody-sequence representation and predicted HER2 monomer confidence. The molecular controls are not Kadcyla or Enhertu's marketed linkers. There is no fitted mapping from these observations to whole-ADC behavior, so `overall_adc_score` is null. Clinical fields remain draft-pending-pharmacist, human-required and blocked.

## Two different LinkerGPTs

[Su et al., Scientific Reports (2025)](https://www.nature.com/articles/s41598-025-05555-3) describes molecular pretraining, ADC-linker fine-tuning and descriptor-reward reinforcement learning. [Author code](https://github.com/su-group/Linker-GPT) uses an 8-layer, 8-head, 256-wide Mol-GPT. The reported validity, novelty, uniqueness and property-threshold results concern computational generation, not ADC efficacy.

[jarod0411/linkerGPT](https://huggingface.co/jarod0411/linkerGPT/tree/3d1bab27707849cd8b6c0fe1cda9d6de48625b1d) instead contains a 12-layer, 12-head, 768-wide GPT-2 checkpoint. The weight digest matches [the uploader's older linker_v6 checkpoint](https://huggingface.co/jarod0411/linker_v6/blob/fa43f575a1a9d39ce6632000b227467dfe3e27af/README.md). Its associated [dataset](https://huggingface.co/datasets/jarod0411/linker_v6/tree/33d0db028847dc43b10e42dc6ce3d37ff098891f) has `smiles`, `p1`, `p2` columns. This is not proof that it is the paper's ADC model.

The HF checkpoint has no declared weights license or documented conditioning recipe. Its model config uses BOS/EOS 50256 while its tokenizer uses BOS 3152, EOS 0, PAD 3153; tokenizer size is 3154 versus 50257 model output IDs. We used explicit tokenizer IDs and suppressed unmapped IDs for a private, exploratory format probe. This is an adapter choice, not an author-approved reproduction.

Twelve BOS-only probes at seed 41 use 96 new tokens, temperature 1, top-k 50, top-p .95 on CPU float32. Raw strings and completion flags are retained. Fragment markers and truncation are not repaired into SMILES. A parse failure on a serialized fragment record is not evidence that the model failed at its intended task. NLL is teacher-forced over the re-tokenized, decoded serialization, wrapped in BOS/EOS even when generation was truncated. It includes an artificial EOS event for incomplete probes, so it is not the likelihood of the exact sampled trajectory. It measures this reconstructed text's token fit only. These probes must not become a generation-quality benchmark.

No weights are bundled. The running app makes zero model/provider calls. Public redistribution of checkpoint-derived observations and any future model activation require reuse review and separate deployment approval.

## What is calculated

RDKit 2025.3.6 parses and sanitizes each synthetic SMILES, checks one connected graph and exactly two terminal wildcard atoms with distinct atom maps 1 and 2. These handles are a toy representation convention, not proof of attachment chemistry. Wildcards are hydrogen-capped before descriptor calculation. We report MW (g/mol), calculated LogP, TPSA (Å²), QED and the RDKit SA score (1–10, lower is easier by that heuristic).

The illustrative proxy is `clip(QED + (1 - SA/10) - 0.1 * number_of_rings, 0, 1)`, adapted from the author RL code. It is not the HF model's training objective or an ADC quality score. It saturates at 1 for several controls. The no-handle control and a two-handle fragment both get 1, while the independent graph check distinguishes them. This is a constructed software demonstration, not measured reward hacking by an agent.

ESM-2 `facebook/esm2_t33_650M_UR50D`, revision `08e4846e537177426273712802403f7ba8261b6c`, mean-pools the heavy/light variable domains separately and concatenates the vectors (2×1280). The existing Thera-SAbDab source and workbook hashes reproduce exactly; all pairwise cosine and alignment-identity values reproduced at their stored precision. The import covers 29/31 workbook rows. Two unmatched records remain missing. No affinity or product equivalence is inferred. Kadcyla and Enhertu share the matched trastuzumab sequences, so their cosine/identity observations are identical despite different ADC chemistry.

The ESM generator now uses repo-relative inputs, safe loading and per-record sequence digests. Its rank-correlation diagnostic now uses tie-aware Spearman correlation rather than assigning arbitrary ranks to ties. This diagnostic is exploratory, not an efficacy benchmark.

HER2/ERBB2 `P04626`, canonical `AF-P04626-F1` v6, comes from [AlphaFold DB](https://alphafold.ebi.ac.uk/api/prediction/P04626), CC-BY-4.0. The 1255 pLDDT values come from the [confidence file](https://alphafold.ebi.ac.uk/files/AF-P04626-F1-confidence_v6.json). The schema recomputes the mean and fraction below 50. It is target-monomer local confidence, not a complex or binding-affinity prediction. OpenFold, ESMFold, AF3 and AlphaGenome were not run; Antigravity Science skills were researched, not connected to the app.

## Missing observations

Binding affinity, conjugation-site compatibility, serum stability, cleavage kinetics, payload activity and whole-ADC efficacy are unmeasured. Withheld components return null plus an explicit missing-observation entry. Descriptor success cannot change label-evidence verdicts or clinical gates.

## Reproduction

The application uses the committed observation JSON, not downloaded executable code or pickle weights. The Python jobs use safe Transformers classes with `trust_remote_code=False` and safetensors. Pin the HF revision above when downloading weights; do not substitute `main`. The job checks the weight digest before loading. Versions, dtype, input/config/tokenizer/weight digests, generator digest, seed, limits, timestamps and source digests are recorded in the artifact. API exports add artifact and controller digests. Hashes establish consistency, not scientific truth.

The local observation job was reproduced with identical molecule records and confidence values:

```sh
python scripts/score_models.py --cache /absolute/path/to/pinned-hf-snapshot
python scripts/embed_antibodies.py --csv /absolute/path/to/therasabdab.csv
npm run eval:models
npm run replay:models -- /absolute/path/to/export.json
npm run check
```

The cached raw structure metadata/confidence files are included under `data/model_sources`. The Thera-SAbDab CSV must match the source digest in the embedding artifact. Running a Python job is different from artifact replay. Replay never calls a model, never retries an upstream request and rejects altered observations, checks, prose, policies and hashes.

## Access decisions

HF authentication gives repository access, not a hosted folding endpoint. No paid HF provider requests or GPU provisioning were used. OpenFold requires a compatible checkpoint and substantial setup; AF3 requires separate access, terms and compute. AlphaGenome's regulatory-variant task is unrelated to this linker scorecard. See `docs/INTEGRATIONS.md` for provider boundaries. Do not present any of these as having run.

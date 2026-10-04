# Live inference and MCP

The Linker lab has a live inference path alongside the frozen component views.
The two paths have different meanings. A saved view replays imported observations.
A live request calls the hosted HF model once.

## The working path

```
Linker lab
  → strict sequence ID and research-use confirmation
  → local MCP client, standard stdio transport
  → score_masked_antibody MCP tool
  → HF inference service, facebook/esm2_t33_650M_UR50D
  → strict response checks and separate research observation
```

The MCP server uses the official TypeScript SDK. It is a local child process, not
an unauthenticated public service. The server can score either the public
trastuzumab heavy variable domain or a synthetic reversed-sequence control.
The control preserves amino-acid composition and tyrosine at position 33.
MCP callers cannot choose a URL, a model, a sequence, a position or token targets.

The public reference is the same Thera-SAbDab Trastuzumab `HeavySequence` used by
the existing embedding script. The imported CSV SHA-256 is
`cc9402788297ed7b6ab3d676daa21953a6d28ebbd9cc78ec7248b19f74d49d6d`.
Reference sequence provenance: https://opig.stats.ox.ac.uk/webapps/therasabdab/ .

Both requests mask position 33 and request the probability assigned to tyrosine.
Single-residue NLL is `-ln(p)` in nats. Zero probability produces a null NLL to
avoid inventing a finite value for numerical underflow. This is neither a
whole-sequence likelihood nor an ADC efficacy or binding score.

Read-only discovery was also tested through HF's remote MCP server at
`https://huggingface.co/mcp`, calling `hub_repo_details` for ESM-2 650M,
`jarod0411/linkerGPT` and `facebook/esmfold_v1`. No Jobs or community Space tools
were executed. This engineering-time connection is not a new app runtime tool.

The HF Hub currently lists ESM-2 650M with a live `hf-inference` provider for
`fill-mask`. Its current Hub commit is
`08e4846e537177426273712802403f7ba8261b6c`. The routed API does not attest the served
weight revision. Results say `served_revision_verified: false`; that Hub commit
must not be described as a verified serving pin. A custom worker is needed for
revision-controlled pooled embeddings.

The controller records input and raw response hashes, the provider, task,
one provider call, request time and the unverified serving revision. The reader
caps responses at 32 KiB. It checks the returned residue, token ID, score range
and reconstructed sequence. Input hashes are bound to the allowlisted request.
The export retains only the bounded, validated provider JSON. Both the controller
and browser check the retained response hash and reconstructed sequence hash;
the displayed probability must match that response. A live JSON export is an
observation log, not deterministic model replay or authenticated proof of HF
execution. These checks validate internal consistency, not
scientific truth. Clinical probabilities remain null and clinical release is blocked.

## Enable locally

Run `npm ci`, then set `HF_TOKEN` in the process environment and
`HF_INFERENCE_ENABLED=true` before `npm start`. Never use a `VITE_` variable for
credentials. The public Space is unchanged and live inference is off by default.
The MCP child receives the HF token but no Anthropic key.

`GET /api/models/inference` reports availability and the two allowed inputs.
`POST /api/models/inference` accepts:

```json
{"sequence_id":"trastuzumab_vh","synthetic_confirmed":true}
```

There is one active request and at most 20 accepted requests per API instance.
Each MCP process permits one inference call. A failed attempt consumes its local
allowance. These are demonstration limits, not an account-wide spending cap;
restarting or replicating the server resets the allowance. Public deployment
needs authentication, a durable usage limit and separate user authorization.
No retries, automatic provider switching or fallback to a frozen result occur.
Cancellation closes the MCP child. The parent deadline includes process setup.

To expose the tool to a local MCP client, use Node with the `tsx` import and
`apps/api/src/model-mcp-server.ts` as the entry point. Set the workspace as its
working directory and provide `HF_TOKEN` securely. This one-call server is a demo
integration, not a persistent multi-user job service.

## What MCP adds

MCP gives Claude or another client a standard tool interface. It does not run
the model or turn its output into evidence. The web control now uses MCP for
live scoring. Research chat still uses its existing native evidence tool; it
does not yet call the scientific model tool.

HF's own MCP server supports model, paper and documentation discovery plus
selected Space tools. It does not make every Hub checkpoint remotely runnable.
For production, allow only reviewed discovery tools. Job creation and arbitrary
Space execution need separate cost and security review.

Anthropic's direct MCP connector needs a publicly reachable HTTP MCP server.
It cannot connect directly to this local stdio server. The app can instead keep
its native tool loop and have its controller call a local MCP client. That
avoids exposing an inference-spending endpoint publicly.

## Full molecular inference

- **ESM pooled embeddings:** a pinned PyTorch/Transformers worker with explicit
  residue pooling and separate VH/VL inputs. ESM is not in TEI's documented
  supported model families. Use a custom HF Endpoint handler or container,
  rather than assuming a generic text-embedding engine supports it.
- **Linker generation:** a separate molecular worker with RDKit checks and
  retained raw output. `jarod0411/linkerGPT` has no provider mapping or declared
  license. Its undocumented conditioning remains a blocker to paper-equivalent
  claims. Neither MCP nor vLLM fixes that.
- **Folding:** a separate compute job with sequence and structure artifacts.
  `facebook/esmfold_v1` has no provider mapping in the current Hub response.
  OpenFold and AF3 remain not run. Imported AlphaFold DB confidence remains a
  target-monomer observation.

Those workers should emit separate observations, never one combined ADC score.
Provisioning a dedicated Endpoint or GPU remains a user cost decision.
HF's current billing docs say PRO/Team subscription credits can apply to
Providers, Endpoints, Spaces and Jobs. The user's actual credit type and balance
must be checked before treating them as interchangeable.

## Sources checked

- HF inference and fill-mask API: https://huggingface.co/docs/inference-providers/providers/hf-inference and https://huggingface.co/docs/inference-providers/tasks/fill-mask
- Provider mapping: https://huggingface.co/api/models/facebook/esm2_t33_650M_UR50D?expand[]=inferenceProviderMapping
- HF MCP: https://huggingface.co/docs/hub/en/hf-mcp-server
- Spaces as MCP tools: https://huggingface.co/docs/hub/en/spaces-mcp-servers
- Claude MCP connector: https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
- MCP SDK: https://ts.sdk.modelcontextprotocol.io/server and https://ts.sdk.modelcontextprotocol.io/client
- TEI model families: https://huggingface.co/docs/text-embeddings-inference/supported_models
- Custom workers: https://huggingface.co/docs/inference-endpoints/guides/custom_handler and https://huggingface.co/docs/inference-endpoints/main/engines/custom_container
- Billing: https://huggingface.co/docs/inference-providers/main/en/pricing

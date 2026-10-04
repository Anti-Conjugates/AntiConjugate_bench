import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MODEL_CHECK_DETAILS, MODEL_MISSING_OBSERVATIONS, ModelCatalogSchema, ModelRequestSchema, ModelResultSchema, ModelSequenceSchema, ModelSnapshotSchema, type ModelRequest, type ModelResult, type ModelSnapshot } from '@her2/shared';
import { z } from 'zod';
import { ApiFailure } from './errors.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const observationText = readFileSync(new URL('../../../data/model_observations.json', import.meta.url), 'utf8');
const sequenceText = readFileSync(new URL('../../../data/antibody_embeddings.json', import.meta.url), 'utf8');
const snapshot = ModelSnapshotSchema.parse(JSON.parse(observationText));
const metadataText = readFileSync(new URL('../../../data/model_sources/her2_alphafold_metadata.json', import.meta.url), 'utf8');
const confidenceText = readFileSync(new URL('../../../data/model_sources/her2_alphafold_confidence.json', import.meta.url), 'utf8');
verifyModelSources(snapshot, metadataText, confidenceText);
const sequence = z.object({
  model: z.object({ id: z.literal('facebook/esm2_t33_650M_UR50D'), revision: z.literal('08e4846e537177426273712802403f7ba8261b6c') }),
  generated_at: z.string(), sequence_source: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  records: z.array(z.object({ id: z.string(), therasabdab_name: z.string(), input_sequence_sha256: z.string().regex(/^[a-f0-9]{64}$/) })).length(29),
  cosine: z.array(z.array(z.number().finite().min(-1).max(1)).length(29)).length(29),
  identity: z.array(z.array(z.number().finite().min(0).max(1)).length(29)).length(29)
}).parse(JSON.parse(sequenceText));
export const MODEL_SNAPSHOT_SHA256 = hash(observationText);
const sequenceSha = hash(sequenceText);
const codeSha = hash(['./models.ts', './models-routes.ts', '../../../packages/shared/src/models.ts', '../../../scripts/score_models.py'].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n'));

export function verifyModelSources(observations: ModelSnapshot, metadataRaw: string, confidenceRaw: string) {
  const confidence = z.object({ confidenceScore: z.array(z.number().finite()).length(1255) }).parse(JSON.parse(confidenceRaw));
  const metadata = z.array(z.object({ entryId: z.string(), uniprotAccession: z.string(), latestVersion: z.number(),
    sequence: z.string(), modelCreatedDate: z.string(), toolUsed: z.string(), isComplex: z.boolean(), plddtDocUrl: z.string() })).parse(JSON.parse(metadataRaw));
  const entries = metadata.filter(r => r.entryId === observations.structure.entry_id && r.uniprotAccession === 'P04626' && r.latestVersion === 6);
  const entry = entries[0];
  if (hash(metadataRaw) !== observations.structure.metadata_sha256 || hash(confidenceRaw) !== observations.structure.confidence_sha256
    || JSON.stringify(confidence.confidenceScore) !== JSON.stringify(observations.structure.plddt) || entries.length !== 1 || !entry
    || entry.isComplex || entry.sequence.length !== 1255 || hash(entry.sequence) !== observations.structure.sequence_sha256
    || entry.modelCreatedDate !== observations.structure.model_created_at || entry.toolUsed !== observations.structure.method
    || entry.plddtDocUrl !== observations.structure.confidence_url) throw new ApiFailure('MODEL_ARTIFACT_INVALID', 500);
}

export function buildModelCatalog() {
  return ModelCatalogSchema.parse({
    snapshot, snapshot_sha256: MODEL_SNAPSHOT_SHA256,
    code_sha256: codeSha, sequence_artifact_sha256: sequenceSha,
    sequences: { DRG0CYMEB: sequenceObservation('DRG0CYMEB'), DRG0ERKBH: sequenceObservation('DRG0ERKBH') },
    products: [{ id: 'DRG0CYMEB', name: 'Kadcyla' }, { id: 'DRG0ERKBH', name: 'Enhertu' }],
    unavailable: [
      { name: 'OpenFold / ESMFold', reason: 'Not run. No hosted folding provider or safe local folding checkpoint was verified.', url: 'https://openfold.readthedocs.io/en/latest/Inference.html' },
      { name: 'AlphaFold 3', reason: 'Not connected. Requires separate access, terms and compute; target metadata below is AlphaFold DB, not AF3.', url: 'https://github.com/google-deepmind/alphafold3' },
      { name: 'AlphaGenome', reason: 'Not run. Regulatory-variant models do not score ADC linker chemistry.', url: 'https://www.alphagenomedocs.com/' },
      { name: 'Antigravity Science skills', reason: 'Reviewed as engineering tools. Their presence is not a model execution.', url: 'https://github.com/google-deepmind/science-skills' }
    ]
  });
}

export function runModels(input: unknown): ModelResult {
  const parsed = ModelRequestSchema.safeParse(input);
  if (!parsed.success) throw new ApiFailure('INVALID_REQUEST', 400);
  const request = parsed.data;
  const molecule = snapshot.molecules.find(m => m.id === request.molecule_id);
  if (!molecule) throw new ApiFailure('INVALID_REQUEST', 400);
  const useSequence = request.observation_policy === 'all' || request.observation_policy === 'without_structure';
  const useStructure = request.observation_policy === 'all' || request.observation_policy === 'without_sequence';
  const missing: string[] = [...MODEL_MISSING_OBSERVATIONS];
  if (!useSequence) missing.push('Sequence observation withheld.');
  if (!useStructure) missing.push('Target structure observation withheld.');
  return ModelResultSchema.parse({
    version: 'conjugate-models-1', request, snapshot_sha256: MODEL_SNAPSHOT_SHA256,
    sequence_artifact_sha256: sequenceSha, code_sha256: codeSha, execution: 'frozen_observations', model_calls: 0,
    molecule,
    sequence: useSequence ? sequenceObservation(request.product_id) : null,
    structure: useStructure ? snapshot.structure : null,
    checks: [
      { id: 'valid_smiles', passed: molecule.valid, detail: MODEL_CHECK_DETAILS.valid_smiles },
      { id: 'connected', passed: molecule.connected, detail: MODEL_CHECK_DETAILS.connected },
      { id: 'two_attachments', passed: molecule.has_two_mapped_attachments, detail: MODEL_CHECK_DETAILS.two_attachments }
    ],
    missing, overall_adc_score: null, clinical_status: 'draft_pending_pharmacist', eligibility: 'not_assessed',
    needs_human: true, guardrail: { status: 'blocked' }, answer_correctness_probability: null, omission_probability: null
  });
}

function sequenceObservation(product: ModelRequest['product_id']) {
  const row = sequence.records.findIndex(r => r.id === product && r.therasabdab_name === 'Trastuzumab');
  const reference = sequence.records.findIndex(r => r.id === 'DRG0CYMEB' && r.therasabdab_name === 'Trastuzumab');
  if (row < 0 || reference < 0) throw new ApiFailure('MODEL_ARTIFACT_INVALID', 500);
  return ModelSequenceSchema.parse({
    model_id: sequence.model.id, revision: sequence.model.revision, generated_at: sequence.generated_at,
    source_sha256: sequence.sequence_source.sha256, input_sequence_sha256: sequence.records[row]?.input_sequence_sha256,
    reference_product_id: 'DRG0CYMEB', antibody: 'Trastuzumab', cosine: sequence.cosine[row]?.[reference], identity: sequence.identity[row]?.[reference]
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function replayModels(input: unknown) {
  const parsed = ModelResultSchema.safeParse(input);
  if (!parsed.success || canonical(parsed.data) !== canonical(runModels(parsed.data.request))) {
    throw new ApiFailure('MODEL_REPLAY_REJECTED', 400);
  }
  return { verified: true as const, snapshot_sha256: MODEL_SNAPSHOT_SHA256, scope: 'Artifact consistency only; model inference was not repeated.' };
}

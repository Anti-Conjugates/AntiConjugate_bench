import { z } from 'zod';

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const Finite = z.number().finite();
export const ModelPolicySchema = z.enum(['all', 'without_structure', 'without_sequence', 'chemistry_only']);
export const ModelRequestSchema = z.object({
  product_id: z.enum(['DRG0CYMEB', 'DRG0ERKBH']),
  molecule_id: z.string().regex(/^(control|sample)-[0-9]{2}$/),
  observation_policy: ModelPolicySchema,
  synthetic_confirmed: z.literal(true)
}).strict();

export const MoleculeObservationSchema = z.object({
  id: z.string().regex(/^(control|sample)-[0-9]{2}$/),
  name: z.string().max(100),
  origin: z.enum(['synthetic_control', 'checkpoint_sample']),
  adapter_trial: z.boolean(),
  completed_with_eos: z.boolean().nullable(),
  smiles: z.string().max(1024),
  canonical_smiles: z.string().max(1024).nullable(),
  valid: z.boolean(),
  connected: z.boolean(),
  attachment_points: z.number().int().min(0).max(100),
  has_two_mapped_attachments: z.boolean(),
  descriptors: z.object({
    molecular_weight: Finite.nonnegative(), logp: Finite, tpsa: Finite.nonnegative(),
    qed: Finite.min(0).max(1), sa_score: Finite.min(1).max(10)
  }).strict().nullable(),
  mean_token_nll: Finite.nullable(),
  proxy_reward: Finite.min(0).max(1).nullable(),
  depiction_svg: z.string().max(100_000).nullable()
}).strict().superRefine((m, ctx) => {
  if (m.valid !== (m.canonical_smiles !== null && m.descriptors !== null && m.proxy_reward !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Validity and descriptors disagree.' });
  }
  if (m.has_two_mapped_attachments && (!m.valid || !m.connected || m.attachment_points !== 2)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Attachment check disagrees.' });
  }
  if (m.adapter_trial !== (m.origin === 'checkpoint_sample') || (!m.adapter_trial && m.completed_with_eos !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Adapter-trial metadata disagrees.' });
  }
});

const ModelSnapshotBaseSchema = z.object({
  version: z.literal('conjugate-models-1'), generated_at: z.string().datetime(), generator_sha256: Sha256,
  linker_model: z.object({
    id: z.literal('jarod0411/linkerGPT'), revision: z.literal('3d1bab27707849cd8b6c0fe1cda9d6de48625b1d'), weights_sha256: Sha256,
    tokenizer_sha256: Sha256, config_sha256: Sha256, input_sha256: Sha256, dtype: z.literal('float32'), license: z.literal('not_declared'),
    paper_checkpoint_equivalence: z.literal('not_verified'), device: z.literal('cpu'),
    invocation_kind: z.literal('unconditioned_format_probe'),
    seed: z.number().int(), sample_count: z.literal(12), max_new_tokens: z.literal(96),
    temperature: z.literal(1), top_k: z.literal(50), top_p: z.literal(0.95),
    bos_token_id: z.literal(3152), eos_token_id: z.literal(0), pad_token_id: z.literal(3153),
    suppressed_unmapped_tokens: z.literal(true), provider_requests: z.literal(0), retries: z.literal(0)
  }).strict(),
  tools: z.object({ python: z.string(), torch: z.string(), transformers: z.string(), rdkit: z.string(), numpy: z.string() }).strict(),
  molecules: z.array(MoleculeObservationSchema).min(16).max(24),
  structure: z.object({
    provider: z.literal('AlphaFold DB'), method: z.literal('AlphaFold Monomer v2.0 pipeline'),
    uniprot_id: z.literal('P04626'), entry_id: z.literal('AF-P04626-F1'), version: z.literal(6),
    model_created_at: z.string(), metadata_url: z.literal('https://alphafold.ebi.ac.uk/api/prediction/P04626'),
    confidence_url: z.literal('https://alphafold.ebi.ac.uk/files/AF-P04626-F1-confidence_v6.json'),
    metadata_sha256: Sha256, confidence_sha256: Sha256, sequence_sha256: Sha256,
    residue_count: z.literal(1255), mean_plddt: Finite.min(0).max(100),
    below_50_fraction: Finite.min(0).max(1), plddt: z.array(Finite.min(0).max(100)).length(1255),
    license: z.literal('CC-BY-4.0'), role: z.literal('target_monomer_only')
  }).strict()
}).strict();
export const ModelSnapshotSchema = ModelSnapshotBaseSchema.superRefine((s, ctx) => {
  const ids = s.molecules.map(m => m.id);
  if (new Set(ids).size !== ids.length || s.molecules.filter(m => m.origin === 'checkpoint_sample').length !== 12) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Molecule batch identity/count mismatch.' });
  }
  const mean = s.structure.plddt.reduce((a, b) => a + b, 0) / 1255;
  const low = s.structure.plddt.filter(v => v < 50).length / 1255;
  if (Math.abs(mean - s.structure.mean_plddt) > 0.00001 || Math.abs(low - s.structure.below_50_fraction) > 0.00001) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Structure summaries disagree with residues.' });
  }
});

export const MODEL_CHECK_DETAILS = {
  valid_smiles: 'RDKit parse and sanitization.',
  connected: 'Exactly one connected molecular graph.',
  two_attachments: 'Two terminal dummy atoms mapped 1 and 2. This is a toy representation check, not conjugation proof.'
} as const;
export const MODEL_MISSING_OBSERVATIONS = [
  'Antibody–HER2 binding affinity was not measured.',
  'Conjugation chemistry and site compatibility were not assessed.',
  'Serum stability and cleavage kinetics were not measured.',
  'Payload activity and whole-ADC efficacy were not measured.',
  'The HF checkpoint license and equivalence to the paper are not established.'
] as const;
export const ModelSequenceSchema = z.object({
  model_id: z.literal('facebook/esm2_t33_650M_UR50D'), revision: z.literal('08e4846e537177426273712802403f7ba8261b6c'),
  generated_at: z.string(), source_sha256: Sha256, input_sequence_sha256: Sha256, reference_product_id: z.literal('DRG0CYMEB'),
  antibody: z.literal('Trastuzumab'), cosine: Finite.min(-1).max(1), identity: Finite.min(0).max(1)
}).strict();
export const ModelResultSchema = z.object({
  version: z.literal('conjugate-models-1'), request: ModelRequestSchema,
  snapshot_sha256: Sha256, sequence_artifact_sha256: Sha256, code_sha256: Sha256,
  execution: z.literal('frozen_observations'), model_calls: z.literal(0),
  molecule: MoleculeObservationSchema,
  sequence: ModelSequenceSchema.nullable(),
  structure: ModelSnapshotBaseSchema.shape.structure.nullable(),
  checks: z.array(z.object({ id: z.enum(['valid_smiles', 'connected', 'two_attachments']), passed: z.boolean(), detail: z.string() }).strict()).length(3),
  missing: z.array(z.string()).min(5).max(10),
  overall_adc_score: z.null(), clinical_status: z.literal('draft_pending_pharmacist'),
  eligibility: z.literal('not_assessed'), needs_human: z.literal(true),
  guardrail: z.object({ status: z.literal('blocked') }).strict(),
  answer_correctness_probability: z.null(), omission_probability: z.null()
}).strict().superRefine((r, ctx) => {
  const showSequence = ['all', 'without_structure'].includes(r.request.observation_policy);
  const showStructure = ['all', 'without_sequence'].includes(r.request.observation_policy);
  const expected = { valid_smiles: r.molecule.valid, connected: r.molecule.connected, two_attachments: r.molecule.has_two_mapped_attachments };
  if (r.molecule.id !== r.request.molecule_id || showSequence !== (r.sequence !== null)
    || showStructure !== (r.structure !== null) || new Set(r.checks.map(c => c.id)).size !== 3
    || r.checks.some(c => c.passed !== expected[c.id] || c.detail !== MODEL_CHECK_DETAILS[c.id])
    || JSON.stringify(r.missing) !== JSON.stringify([...MODEL_MISSING_OBSERVATIONS,
      ...(!showSequence ? ['Sequence observation withheld.'] : []), ...(!showStructure ? ['Target structure observation withheld.'] : [])])) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Result scope, policy or checks disagree.' });
  }
});
export const ModelCatalogSchema = z.object({
  snapshot: ModelSnapshotSchema, snapshot_sha256: Sha256,
  code_sha256: Sha256, sequence_artifact_sha256: Sha256,
  sequences: z.object({ DRG0CYMEB: ModelSequenceSchema, DRG0ERKBH: ModelSequenceSchema }).strict(),
  products: z.array(z.object({ id: ModelRequestSchema.shape.product_id, name: z.string() }).strict()).length(2),
  unavailable: z.array(z.object({ name: z.string(), reason: z.string(), url: z.enum(['https://openfold.readthedocs.io/en/latest/Inference.html', 'https://github.com/google-deepmind/alphafold3', 'https://www.alphagenomedocs.com/', 'https://github.com/google-deepmind/science-skills']) }).strict()).max(5)
}).strict().refine(c => new Set(c.products.map(p => p.id)).size === 2, 'Duplicate products.');

export type ModelRequest = z.infer<typeof ModelRequestSchema>;
export type ModelResult = z.infer<typeof ModelResultSchema>;
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>;
export type ModelSnapshot = z.infer<typeof ModelSnapshotSchema>;

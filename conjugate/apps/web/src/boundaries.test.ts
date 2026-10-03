import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogSchema, RunResultSchema, type RunRequest } from '@her2/shared';
import { describeFailure, emptyInputs, fetchCatalog, postRun, safeSourceUrl, validateInputs, validateRunResponse } from './boundaries';

// Contract sentinels only: no clinical case, real label content or benchmark answer.
const catalog = CatalogSchema.parse({
  products: [{
    id: 'contract-product', brand: 'Contract sentinel', name: 'Contract sentinel', short_name: 'sentinel',
    antibody: 'sentinel', target: 'HER2', payload: 'sentinel', linker: 'sentinel', dar: 0,
    adcdb_url: 'https://example.org/structure', source_ids: ['contract-source'], description: 'Software contract fixture only.',
  }],
  sources: [{
    id: 'contract-source', title: 'Contract source sentinel', url: 'https://example.org/source#section', jurisdiction: 'UK',
    revision_date: 'contract-date', section: 'contract-section', excerpt: 'Software contract placeholder; not clinical content.',
    review_status: 'draft_pending_pharmacist',
  }],
  default_engine: 'evidence', claude_configured: false, model: 'claude-opus-5-5', scope: 'Software test only', disclaimer: 'Not clinical content.',
});

function blankRequest(): RunRequest {
  const parsed = validateInputs({ ...emptyInputs(), synthetic_confirmed: true }, 'contract-product', 'evidence');
  if (!parsed.success) throw new Error('Blank contract fixture must validate.');
  return parsed.data;
}

function draft() {
  return RunResultSchema.parse({
    id: 'contract-run', created_at: 'contract-date', engine: 'evidence', model: null, product: catalog.products[0],
    clinical_status: 'draft_pending_pharmacist', eligibility: 'not_assessed', verdict: 'dont_know', answer: 'Software contract response only.',
    flags: [], omitted_checks: [], sources: catalog.sources, unknowns: [],
    evidence_confidence: { kind: 'heuristic', level: 'unknown', reason: 'Software sentinel only.' },
    omission_probability: null, answer_correctness_probability: null,
    guardrail: { kind: 'deterministic', status: 'blocked', reasons: ['Approval absent.'] }, needs_human: true, trace: [],
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('synthetic form contract boundary', () => {
  it('starts empty/unknown and requires explicit synthetic confirmation', () => {
    const inputs = emptyInputs();
    expect(inputs.synthetic_confirmed).toBe(false);
    expect(validateInputs(inputs, 'contract-product', 'evidence').success).toBe(false);
    expect(blankRequest().patient).toEqual({
      age: null, renal: 'unknown', hepatic: 'unknown', lung_history: null, neuropathy: null,
      platelets: null, lvef: null, neutrophils: null, medications: [], medication_list_complete: false,
    });
  });

  it('rejects malformed numeric input rather than replacing it with an assumed value', () => {
    const inputs = { ...emptyInputs(), synthetic_confirmed: true, age: 'not-a-number' };
    expect(validateInputs(inputs, 'contract-product', 'evidence').success).toBe(false);
  });

  it('splits medication text on comma/newline, preserving strings only as data', () => {
    const parsed = validateInputs({ ...emptyInputs(), synthetic_confirmed: true, medications: '  string-A,\n string-B, ,\n' }, 'contract-product', 'evidence');
    expect(parsed.success && parsed.data.patient.medications).toEqual(['string-A', 'string-B']);
  });

  it('retains the shared medication length and count limits', () => {
    expect(validateInputs({ ...emptyInputs(), synthetic_confirmed: true, medications: 'x'.repeat(101) }, 'contract-product', 'evidence').success).toBe(false);
    expect(validateInputs({ ...emptyInputs(), synthetic_confirmed: true, medications: Array.from({ length: 31 }, () => 'sentinel').join(',') }, 'contract-product', 'evidence').success).toBe(false);
  });
});

describe('network and source boundaries', () => {
  it('allows exact HTTPS source URLs but not executable, relative or insecure links', () => {
    expect(safeSourceUrl('https://example.org/label#section')).toBe('https://example.org/label#section');
    for (const value of ['javascript:alert(1)', 'data:text/html,test', '/local', 'http://example.org']) expect(safeSourceUrl(value)).toBeUndefined();
  });

  it('parses only the shared catalog on the exact GET endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog)));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchCatalog(new AbortController().signal)).toEqual(catalog);
    expect(fetch).toHaveBeenCalledWith('/api/catalog', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('rejects malformed success responses and inconsistent catalog references', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ not: 'catalog' }))));
    await expect(fetchCatalog(new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_CATALOG' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...catalog, sources: [] }))));
    await expect(fetchCatalog(new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_CATALOG' });
  });

  it('handles a non-JSON backend response without displaying its body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>unexpected response</html>')));
    await expect(fetchCatalog(new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('parses a shared API error and never falls back to a second request', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'TEST_UNAVAILABLE', message: 'Contract test unavailable.' } }), { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(postRun(blankRequest(), catalog, new AbortController().signal)).rejects.toMatchObject({ code: 'TEST_UNAVAILABLE', message: 'Contract test unavailable.' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/runs', expect.objectContaining({ method: 'POST', body: JSON.stringify(blankRequest()) }));
  });

  it('does not expose an unvalidated error body or unknown thrown error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'untrusted error text' }), { status: 500 })));
    await expect(fetchCatalog(new AbortController().signal)).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
    expect(describeFailure(new Error('untrusted error text')).message).not.toContain('untrusted error text');
  });
});

describe('research result safety boundary', () => {
  it('accepts the matching blocked research contract and strips non-contract fields', () => {
    const parsed = validateRunResponse({ ...draft(), patient: { unexpected: true }, extra: 'not exported' }, blankRequest(), catalog);
    expect(parsed.needs_human).toBe(true);
    expect(parsed.guardrail.status).toBe('blocked');
    expect(parsed).not.toHaveProperty('patient');
    expect(parsed).not.toHaveProperty('extra');
    expect(parsed.omission_probability).toBeNull();
    expect(parsed.answer_correctness_probability).toBeNull();
  });

  it.each([
    { needs_human: false }, { clinical_status: 'approved' }, { omission_probability: 0.1 },
    { answer_correctness_probability: 0.9 }, { guardrail: { kind: 'deterministic', status: 'approved', reasons: [] } },
  ])('rejects violations of shared research-only literals: %o', (mutation) => {
    expect(() => validateRunResponse({ ...draft(), ...mutation }, blankRequest(), catalog)).toThrow('contract or safety validation');
  });

  it('rejects a mismatched product, engine or model', () => {
    expect(() => validateRunResponse({ ...draft(), product: { ...catalog.products[0], id: 'other' } }, blankRequest(), catalog)).toThrow('does not match');
    expect(() => validateRunResponse({ ...draft(), engine: 'claude', model: 'claude-opus-5-5' }, blankRequest(), catalog)).toThrow('does not match');
    expect(() => validateRunResponse({ ...draft(), model: 'unexpected-model' }, blankRequest(), catalog)).toThrow('does not match');
  });

  it('rejects altered source URLs and unallowlisted source IDs', () => {
    expect(() => validateRunResponse({ ...draft(), sources: [{ ...catalog.sources[0], url: 'https://example.org/altered' }] }, blankRequest(), catalog)).toThrow('citations');
    expect(() => validateRunResponse({ ...draft(), sources: [{ ...catalog.sources[0], id: 'unallowlisted-source' }] }, blankRequest(), catalog)).toThrow('citations');
  });

  it('checks selected and omitted flag citations against returned allowlisted sections', () => {
    const flag = { id: 'contract-flag', title: 'Contract sentinel', description: 'Software sentinel only.', severity: 'review', basis: 'label', source_ids: ['missing-source'], context: '' };
    for (const section of ['flags', 'omitted_checks']) {
      expect(() => validateRunResponse({ ...draft(), [section]: [flag] }, blankRequest(), catalog)).toThrow('citations');
    }
  });
});

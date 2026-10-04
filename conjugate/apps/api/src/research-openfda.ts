import { readFileSync } from 'node:fs';
import { OpenFdaSnapshotSchema, ResearchReceiptSchema, type ResearchRequest, type ResearchReceipt } from '@her2/shared';

const identities = {
  DRG0CYMEB: { brand: 'KADCYLA', generic: 'ADO-TRASTUZUMAB EMTANSINE', application: 'BLA125427' },
  DRG0ERKBH: { brand: 'Enhertu', generic: 'FAM-TRASTUZUMAB DERUXTECAN-NXKI', application: 'BLA761139' }
} as const;
export function validateOpenFdaSnapshot(value: unknown) {
 const snapshot = OpenFdaSnapshotSchema.parse(value);
 if (new Set(snapshot.records.map(record => record.product_id)).size !== 2) throw new Error('Duplicate openFDA snapshot product.');
 for (const record of snapshot.records) {
  const expected = identities[record.product_id];
  if (record.brand_name.length !== 1 || record.brand_name[0] !== expected.brand
    || record.generic_name.length !== 1 || record.generic_name[0] !== expected.generic
    || record.application_number.length !== 1 || record.application_number[0] !== expected.application) throw new Error('openFDA snapshot identity mismatch.');
  const searches = [new URLSearchParams({ search: `openfda.brand_name.exact:"${expected.brand}"`, limit: '1', sort: 'effective_time:desc' }),
    new URLSearchParams({ search: `id:"${record.id}"`, limit: '1' })];
  for (const [index, url] of [record.query_url, record.record_url].entries()) {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://api.fda.gov' || parsed.pathname !== '/drug/label.json' || parsed.username || parsed.password
      || parsed.hash || parsed.searchParams.toString() !== searches[index]!.toString()) {
      throw new Error('Untrusted openFDA snapshot URL.');
    }
  }
 }
 return snapshot;
}
const snapshot = validateOpenFdaSnapshot(JSON.parse(readFileSync(new URL('./openfda.snapshot.json', import.meta.url), 'utf8')));
export function openFdaSourceId(id: ResearchRequest['product_id']) { return `US-OPENFDA-${id}-IDENTITY`; }
export function openFdaReceipt(request: ResearchRequest): ResearchReceipt {
  const record = snapshot.records.find(item => item.product_id === request.product_id)!;
  return ResearchReceiptSchema.parse({
    id: openFdaSourceId(request.product_id), product_id: request.product_id, kind: 'openfda',
    title: `${record.brand_name[0]} US openFDA identity record`, url: record.record_url,
    section: `US; openfda identity fields; SPL set ${record.set_id}; version ${record.version}; fetched ${record.fetched_at}; response SHA-256 ${record.raw_response_sha256}`,
    revision_date: `${record.effective_time.slice(0, 4)}-${record.effective_time.slice(4, 6)}-${record.effective_time.slice(6)}`,
    excerpt: JSON.stringify({ brand_name: record.brand_name, generic_name: record.generic_name,
      application_number: record.application_number, manufacturer_name: record.manufacturer_name, spl_id: record.id, spl_set_id: record.set_id }),
    provenance: 'openfda_identity_snapshot', eligible_for_claim: request.question_id === 'label_identity',
    limitations: ['Frozen US identity fields only; not a UK label or clinical evidence review.',
      'openFDA reformats manufacturer submissions; FDA says the API content is not verified and may differ from approved labeling.',
      'Effective date belongs to the submitted record. Fetch time does not prove freshness. No clinical sections were imported.']
  });
}

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { OpenFdaRecordSchema, OpenFdaSnapshotSchema } from '@her2/shared';
import { z } from 'zod';

const products = [
  { product_id: 'DRG0CYMEB', brand: 'KADCYLA', generic: 'ADO-TRASTUZUMAB EMTANSINE', application: 'BLA125427' },
  { product_id: 'DRG0ERKBH', brand: 'Enhertu', generic: 'FAM-TRASTUZUMAB DERUXTECAN-NXKI', application: 'BLA761139' }
] as const;
const responseSchema = z.object({ results: z.array(z.object({
  id: z.string().uuid(), set_id: z.string().uuid(), version: z.string(), effective_time: z.string(),
  openfda: z.object({ brand_name: z.array(z.string()), generic_name: z.array(z.string()),
    application_number: z.array(z.string()), manufacturer_name: z.array(z.string()), is_original_packager: z.array(z.boolean()) })
})).length(1) });

async function main() {
  const records = [];
  for (const product of products) {
    const url = new URL('https://api.fda.gov/drug/label.json');
    url.search = new URLSearchParams({ search: `openfda.brand_name.exact:"${product.brand}"`, limit: '1', sort: 'effective_time:desc' }).toString();
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`openFDA fetch failed (${response.status}); existing snapshot unchanged.`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('openFDA body unavailable.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) { await reader.cancel(); throw new Error('openFDA response exceeded import limit.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    const record = responseSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))).results[0]!;
    const fields = record.openfda;
    if (fields.brand_name.length !== 1 || fields.brand_name[0] !== product.brand
      || fields.generic_name.length !== 1 || fields.generic_name[0] !== product.generic
      || fields.application_number.length !== 1 || fields.application_number[0] !== product.application
      || fields.is_original_packager.length !== 1 || fields.is_original_packager[0] !== true) {
      throw new Error('openFDA identity mismatch; existing snapshot unchanged.');
    }
    const recordUrl = new URL('https://api.fda.gov/drug/label.json');
    recordUrl.search = new URLSearchParams({ search: `id:"${record.id}"`, limit: '1' }).toString();
    records.push(OpenFdaRecordSchema.parse({ product_id: product.product_id, jurisdiction: 'US',
      id: record.id, set_id: record.set_id, version: record.version, effective_time: record.effective_time,
      fetched_at: new Date().toISOString(), query_url: url.href, record_url: recordUrl.href,
      raw_response_sha256: createHash('sha256').update(bytes).digest('hex'),
      brand_name: fields.brand_name, generic_name: fields.generic_name,
      application_number: fields.application_number, manufacturer_name: fields.manufacturer_name }));
  }
  const snapshot = OpenFdaSnapshotSchema.parse({ kind: 'openfda_identity_snapshot', records });
  writeFileSync(new URL('../apps/api/src/openfda.snapshot.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n');
  console.log('Imported two US identity records. No dosing or clinical sections stored.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Import failed.'); process.exitCode = 1; });

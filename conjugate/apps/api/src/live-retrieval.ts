import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  LiveCatalogSchema, LiveCheckRequestSchema, LiveProductIdSchema, liveProductSources, liveSourceUrl, workbookProduct, LiveCheckResultSchema, LiveReceiptSchema,
  type LiveCatalog, type LiveCheckResult, type LiveComparison, type LiveErrorCode, type LiveProductId, type LiveReceipt, type LiveSourceId
} from '@her2/shared';
import { validateOpenFdaSnapshot } from './research-openfda.js';

export const LIVE_USER_AGENT = 'Conjugate-HER2-research-prototype/0.1 (+https://github.com/Anti-Conjugates/AntiConjugate-Devin; source identity checks only; not clinical use)';
export const LIVE_TIMEOUT_MS = 8_000;
export const LIVE_DEADLINE_MS = 25_000;
export const LIVE_CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 64;

export const LIVE_SOURCES: Record<LiveSourceId, { host: string; max_bytes: number; purpose: string }> = {
  clinicaltrials_gov: { host: 'clinicaltrials.gov', max_bytes: 64_000, purpose: 'Does this NCT id exist? Official title only.' },
  pubmed: { host: 'eutils.ncbi.nlm.nih.gov', max_bytes: 256_000, purpose: 'Does this PMID exist? Title, journal and date only.' },
  openfda: { host: 'api.fda.gov', max_bytes: 1_000_000, purpose: 'US label identity fields compared with the frozen openFDA snapshot.' },
  dailymed: { host: 'dailymed.nlm.nih.gov', max_bytes: 64_000, purpose: 'Current DailyMed SPL set id and version for the brand.' },
  adcdb: { host: 'adcdb.idrblab.net', max_bytes: 1_500_000, purpose: 'ADCdb composition fields compared with the workbook snapshot.' }
};
const LIMITATIONS: Record<LiveSourceId, string[]> = {
  clinicaltrials_gov: ['Shows only that the registry record exists and its title. Says nothing about results, design quality or relevance.'],
  pubmed: ['Shows only that the PubMed record exists and its title, journal and date. The article was not read.'],
  openfda: ['US identity fields only. FDA says openFDA content is not verified and may differ from approved labeling. No clinical sections were read.'],
  dailymed: ['First DailyMed search hit for the brand name. Identity and version only; no label sections were read.'],
  adcdb: ['Text parsed from a public ADCdb web page. ADCdb publishes no licence; treat values as an unofficial copy. Composition fields only.']
};
const COMMON_LIMITATION = 'Live retrieval is not clinical evidence and does not change any verdict. Pending pharmacist review.';

const WorkbookSchema = z.object({ records: z.array(z.object({ id: z.string(), cells: z.array(z.object({ field: z.string(), value: z.string().nullable() })) })) });
const openFda = validateOpenFdaSnapshot(JSON.parse(readFileSync(new URL('./openfda.snapshot.json', import.meta.url), 'utf8')));
const workbook = WorkbookSchema.parse(JSON.parse(readFileSync(new URL('./workbook.snapshot.json', import.meta.url), 'utf8')));
function openFdaRecord(id: LiveProductId) { return openFda.records.find(record => record.product_id === id); }
function workbookCell(id: LiveProductId, field: string) {
  const record = workbook.records.find(item => item.id === id);
  if (!record) throw new Error('Workbook product missing.');
  return record.cells.find(cell => cell.field === field)?.value ?? null;
}

export function assertLiveUrl(source: LiveSourceId, value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== LIVE_SOURCES[source].host || url.port || url.username || url.password || url.hash) {
    throw new Error('Live URL is not on the source allowlist.');
  }
  return url;
}
export function liveUrl(source: LiveSourceId, subject: string): string {
  let url: string;
  if (source === 'clinicaltrials_gov') {
    if (!/^NCT\d{8}$/.test(subject)) throw new Error('Invalid NCT id.');
    url = `https://clinicaltrials.gov/api/v2/studies/${subject}?fields=protocolSection.identificationModule`;
  } else if (source === 'pubmed') {
    const pmid = /^PMID:([1-9]\d{0,8})$/.exec(subject)?.[1];
    if (!pmid) throw new Error('Invalid PMID.');
    url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${new URLSearchParams({ db: 'pubmed', id: pmid, retmode: 'json' })}`;
  } else {
    url = liveSourceUrl(source, LiveProductIdSchema.parse(subject));
  }
  return assertLiveUrl(source, url).toString();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', deg: '\u00b0', middot: '\u00b7' };
function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}
export function htmlTextLines(page: string): string[] {
  const stripped = page.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi, '');
  return decodeEntities(stripped.replace(/<[^>]+>/g, '\n')).split('\n').map(line => line.trim()).filter(Boolean);
}
const ADCDB_LABELS = { adc_name: 'ADC Name', brand: 'Brand Name', antibody: 'Antibody Name', target: 'Antigen Name', payload: 'Payload Name', linker: 'Linker Name', dar: 'Drug-to-Antibody Ratio' } as const;
const WORKBOOK_FIELDS: Record<keyof typeof ADCDB_LABELS, string> = { adc_name: 'ADC name', brand: 'Brand', antibody: 'Antibody', target: 'Target', payload: 'Payload', linker: 'Linker', dar: 'DAR' };
export function parseAdcdbDetail(page: string) {
  const lines = htmlTextLines(page);
  const after = (label: string) => {
    const index = lines.indexOf(label);
    const value = index >= 0 ? lines[index + 1] : undefined;
    return value === undefined || value === 'Click to Show/Hide' || value.endsWith(' Info') ? null : value;
  };
  const id = lines.map(line => /\(ID: (DRG[0-9A-Z]+)\)/.exec(line)?.[1]).find(Boolean) ?? null;
  const fields = Object.fromEntries(Object.entries(ADCDB_LABELS).map(([key, label]) => [key, after(label)])) as Record<keyof typeof ADCDB_LABELS, string | null>;
  return { adc_id: id, ...fields };
}

const normalize = (value: string | null | undefined) => value === null || value === undefined ? null : value.replace(/\s+/g, ' ').trim();
function compare(field: string, snapshot: string | null, live: string | null): LiveComparison {
  const a = normalize(snapshot); const b = normalize(live);
  return { field, snapshot: a, live: b, agrees: a !== null && a === b };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export interface LiveOptions { fetch?: FetchLike; now?: () => number; timeoutMs?: number; deadlineMs?: number; cacheTtlMs?: number }
interface Raw { http_status: number; body: Buffer; fetched_at: string; sha256: string }
type Outcome = ({ ok: true; cached: boolean } & Raw) | { ok: false; code: LiveErrorCode; http_status: number | null; bytes: number; fetched_at: string };
class Oversize extends Error {}

async function readCapped(response: Response, max: number, signal: AbortSignal) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stop = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error('aborted');
      if (done) break;
      total += value.byteLength;
      if (total > max) { stop(); throw new Oversize(); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', stop); }
  if (signal.aborted) throw new Error('aborted');
  return Buffer.concat(chunks);
}

export function createLiveRetriever(options: LiveOptions = {}) {
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? LIVE_TIMEOUT_MS;
  const deadlineMs = options.deadlineMs ?? LIVE_DEADLINE_MS;
  const ttl = options.cacheTtlMs ?? LIVE_CACHE_TTL_MS;
  const cache = new Map<string, Raw & { expires: number }>();
  let adcdbQueue: Promise<unknown> = Promise.resolve();
  const iso = () => new Date(now()).toISOString();

  function cached(url: string): Outcome | null {
    const hit = cache.get(url);
    if (!hit) return null;
    if (hit.expires <= now()) { cache.delete(url); return null; }
    return { ok: true, cached: true, http_status: hit.http_status, body: hit.body, fetched_at: hit.fetched_at, sha256: hit.sha256 };
  }
  async function fetchOnce(source: LiveSourceId, url: string, deadline: AbortSignal, external?: AbortSignal): Promise<Outcome> {
    const fetched_at = iso();
    const fail = (code: LiveErrorCode, http_status: number | null = null, bytes = 0): Outcome => ({ ok: false, code, http_status, bytes, fetched_at });
    const hit = cached(url);
    if (hit) return hit;
    if (external?.aborted) return fail('CANCELLED');
    if (deadline.aborted) return fail('DEADLINE');
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const signal = AbortSignal.any([timeout.signal, deadline, ...(external ? [external] : [])]);
    let status: number | null = null;
    try {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal, headers: { 'user-agent': LIVE_USER_AGENT, accept: source === 'adcdb' ? 'text/html' : 'application/json' } });
      status = response.status;
      let finalOk = true;
      try { if (response.url) assertLiveUrl(source, response.url); } catch { finalOk = false; }
      if ((status >= 300 && status < 400) || response.redirected || !finalOk) {
        void response.body?.cancel().catch(() => undefined);
        return fail('REDIRECT_REJECTED', status);
      }
      const declared = Number(response.headers.get('content-length') ?? '');
      if (Number.isFinite(declared) && declared > LIVE_SOURCES[source].max_bytes) {
        void response.body?.cancel().catch(() => undefined);
        return fail('OVERSIZE', status);
      }
      const body = await readCapped(response, LIVE_SOURCES[source].max_bytes, signal);
      const raw: Raw = { http_status: status, body, fetched_at, sha256: createHash('sha256').update(body).digest('hex') };
      if (status === 200 || status === 404) {
        cache.set(url, { ...raw, expires: now() + ttl });
        while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      }
      return { ok: true, cached: false, ...raw };
    } catch (error) {
      if (error instanceof Oversize) return fail('OVERSIZE', status);
      if (external?.aborted) return fail('CANCELLED', status);
      if (deadline.aborted) return fail('DEADLINE', status);
      if (timeout.signal.aborted) return fail('TIMEOUT', status);
      return fail('NETWORK', status);
    } finally { clearTimeout(timer); }
  }
  function retrieve(source: LiveSourceId, url: string, deadline: AbortSignal, external?: AbortSignal): Promise<Outcome> {
    if (source !== 'adcdb') return fetchOnce(source, url, deadline, external);
    const run = adcdbQueue.then(() => fetchOnce(source, url, deadline, external));
    adcdbQueue = run.catch(() => undefined);
    return run;
  }

  async function receipt(source: LiveSourceId, subject: string, deadline: AbortSignal, external?: AbortSignal): Promise<LiveReceipt> {
    const started = performance.now();
    let url: string;
    try { url = liveUrl(source, subject); } catch { throw new Error('Live subject rejected before fetch.'); }
    const outcome = await retrieve(source, url, deadline, external);
    const base = { source, subject, url, fetched_at: outcome.fetched_at, http_status: outcome.http_status, provenance: 'live_retrieved_unverified' as const,
      limitations: [...LIMITATIONS[source], COMMON_LIMITATION] };
    const duration_ms = Math.round((performance.now() - started) * 10) / 10;
    if (!outcome.ok) return LiveReceiptSchema.parse({ ...base, raw_sha256: null, bytes: outcome.bytes, duration_ms, cached: false, status: 'error', error_code: outcome.code, parsed: {}, comparison: [] });
    const done = (status: LiveReceipt['status'], parsed: Record<string, string | null> = {}, comparison: LiveComparison[] = [], error_code: LiveErrorCode | null = null) =>
      LiveReceiptSchema.parse({ ...base, raw_sha256: outcome.sha256, bytes: outcome.body.byteLength, duration_ms, cached: outcome.cached,
        status: error_code ? 'error' : status, error_code, parsed: error_code ? {} : parsed, comparison: error_code ? [] : comparison });
    try {
      return interpret(source, subject, outcome, done);
    } catch { return done('error', {}, [], 'PARSE'); }
  }

  type Done = (status: LiveReceipt['status'], parsed?: Record<string, string | null>, comparison?: LiveComparison[], error_code?: LiveErrorCode | null) => LiveReceipt;
  function interpret(source: LiveSourceId, subject: string, raw: Raw, done: Done): LiveReceipt {
    const status = raw.http_status;
    const text = () => new TextDecoder('utf-8').decode(raw.body);
    const json = () => JSON.parse(text()) as unknown;
    const str = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : null;
    if (source === 'clinicaltrials_gov') {
      if (status === 404) return done('not_found');
      if (status !== 200) return done('error', {}, [], 'HTTP_STATUS');
      const module = z.object({ protocolSection: z.object({ identificationModule: z.object({ nctId: z.string(), briefTitle: z.string().optional(), officialTitle: z.string().optional() }).passthrough() }).passthrough() }).passthrough().parse(json()).protocolSection.identificationModule;
      if (module.nctId !== subject) return done('error', {}, [], 'IDENTITY_MISMATCH');
      return done('ok', { nct_id: module.nctId, official_title: module.officialTitle ?? null, brief_title: module.briefTitle ?? null });
    }
    if (source === 'pubmed') {
      if (status !== 200) return done('error', {}, [], 'HTTP_STATUS');
      const pmid = subject.slice(5);
      const result = z.object({ result: z.record(z.string(), z.unknown()) }).passthrough().parse(json()).result;
      const record = z.object({ uid: z.string().optional(), error: z.string().optional(), title: z.string().optional(), source: z.string().optional(), pubdate: z.string().optional() }).passthrough().parse(result[pmid] ?? {});
      if (record.error && !record.title) return done('not_found');
      if (record.uid !== pmid || !record.title) return done('error', {}, [], 'IDENTITY_MISMATCH');
      return done('ok', { pmid, title: record.title, journal: record.source ?? null, pubdate: record.pubdate ?? null });
    }
    const product = subject as LiveProductId;
    const snapshot = openFdaRecord(product);
    const identity = workbookProduct(product)!;
    if (source === 'openfda') {
      if (status === 404) return done('not_found');
      if (status !== 200) return done('error', {}, [], 'HTTP_STATUS');
      const results = z.object({ results: z.array(z.object({ id: z.string(), set_id: z.string(), version: z.unknown(), effective_time: z.unknown(),
        openfda: z.object({ brand_name: z.array(z.string()).optional(), generic_name: z.array(z.string()).optional(), application_number: z.array(z.string()).optional(), manufacturer_name: z.array(z.string()).optional() }).passthrough() }).passthrough()) }).passthrough().parse(json()).results;
      const live = results[0];
      if (!live) return done('not_found');
      const join = (value: string[] | undefined) => value?.length ? value.join('; ') : null;
      const parsed = { spl_id: live.id, set_id: live.set_id, version: str(live.version), effective_time: str(live.effective_time),
        brand_name: join(live.openfda.brand_name), generic_name: join(live.openfda.generic_name), application_number: join(live.openfda.application_number), manufacturer_name: join(live.openfda.manufacturer_name) };
      // Products without a frozen openFDA record are compared on identity only: exact brand and workbook INN.
      const comparison = snapshot ? [compare('brand_name', snapshot.brand_name.join('; '), parsed.brand_name), compare('generic_name', snapshot.generic_name.join('; '), parsed.generic_name),
        compare('application_number', snapshot.application_number.join('; '), parsed.application_number), compare('set_id', snapshot.set_id, parsed.set_id),
        compare('version', snapshot.version, parsed.version), compare('effective_time', snapshot.effective_time, parsed.effective_time), compare('spl_id', snapshot.id, parsed.spl_id)]
        : [compare('brand_name', identity.us_label?.openfda ?? null, parsed.brand_name), compare('generic_name', identity.name.toUpperCase(), parsed.generic_name?.toUpperCase().replace(/-[A-Z]{4}$/, '') ?? null)];
      return done(comparison.every(row => row.agrees) ? 'ok' : 'drift', parsed, comparison);
    }
    if (source === 'dailymed') {
      if (status !== 200) return done('error', {}, [], 'HTTP_STATUS');
      const data = z.object({ data: z.array(z.object({ setid: z.string(), spl_version: z.unknown(), published_date: z.unknown(), title: z.unknown() }).passthrough()) }).passthrough().parse(json()).data;
      const live = data[0];
      if (!live) return done('not_found');
      const parsed = { set_id: live.setid, spl_version: str(live.spl_version), published_date: str(live.published_date), title: str(live.title) };
      const titleBrand = parsed.title?.toUpperCase().startsWith(`${identity.us_label?.dailymed ?? ''} `) ? identity.us_label?.dailymed ?? null : parsed.title;
      const comparison = snapshot ? [compare('set_id', snapshot.set_id, parsed.set_id), compare('version', snapshot.version, parsed.spl_version)] : [compare('title_brand', identity.us_label?.dailymed ?? null, titleBrand)];
      return done(comparison.every(row => row.agrees) ? 'ok' : 'drift', parsed, comparison);
    }
    if (status === 404) return done('not_found');
    if (status !== 200) return done('error', {}, [], 'HTTP_STATUS');
    const page = parseAdcdbDetail(text());
    if (page.adc_id !== product) return done('error', {}, [], 'IDENTITY_MISMATCH');
    if (!page.antibody && !page.payload && !page.linker) return done('error', {}, [], 'PARSE');
    const comparison = (Object.keys(WORKBOOK_FIELDS) as (keyof typeof WORKBOOK_FIELDS)[]).map(key => compare(key, workbookCell(product, WORKBOOK_FIELDS[key]), page[key]));
    return done(comparison.every(row => row.agrees) ? 'ok' : 'drift', page, comparison);
  }

  async function check(input: unknown, external?: AbortSignal): Promise<LiveCheckResult> {
    const request = LiveCheckRequestSchema.parse(input);
    const started = performance.now();
    const created_at = iso();
    const references = [...new Set(request.references ?? [])];
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), deadlineMs);
    try {
      const jobs: Promise<LiveReceipt>[] = [];
      if (request.product_id) for (const source of liveProductSources(request.product_id)) jobs.push(receipt(source, request.product_id, deadline.signal, external));
      for (const reference of references) jobs.push(receipt(reference.startsWith('NCT') ? 'clinicaltrials_gov' : 'pubmed', reference, deadline.signal, external));
      const receipts = await Promise.all(jobs);
      const counts = { ok: 0, not_found: 0, drift: 0, error: 0 };
      for (const item of receipts) counts[item.status]++;
      return LiveCheckResultSchema.parse({
        kind: 'live_source_retrieval_check_not_clinical', created_at, product_id: request.product_id ?? null, references, receipts, counts,
        duration_ms: Math.round(performance.now() - started), clinical_status: 'draft_pending_pharmacist', needs_human: true,
        guardrail: { kind: 'deterministic', status: 'blocked', reasons: ['Live source checks cover identity, reference existence and composition only. They are not clinical evidence.', 'All clinical content stays blocked until a pharmacist approves it.'] },
        answer_correctness_probability: null, omission_probability: null, overall_adc_score: null,
        limitations: ['Every URL comes from a fixed template keyed by an allowlisted product id or a validated reference id. No model chose a URL.',
          'Errors are reported as error receipts. Nothing falls back to the frozen snapshot.', 'Fetched data is unverified and may change between requests.']
      });
    } finally { clearTimeout(timer); }
  }
  function catalog(enabled: boolean): LiveCatalog {
    return LiveCatalogSchema.parse({ enabled, sources: (Object.keys(LIVE_SOURCES) as LiveSourceId[]).map(id => ({ id, ...LIVE_SOURCES[id] })),
      timeout_ms: timeoutMs, deadline_ms: deadlineMs, max_references: 4, user_agent: LIVE_USER_AGENT });
  }
  return { check, catalog };
}
export type LiveRetriever = ReturnType<typeof createLiveRetriever>;

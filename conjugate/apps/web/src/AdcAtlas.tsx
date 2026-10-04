import { useMemo, useState } from 'react';
import type { ResearchCatalog, WorkbookRecord } from '@her2/shared';
import { Search, X } from 'lucide-react';
import { AntibodyMap } from './AntibodyMap';

const unverifiedFields = new Set(['Toxicity (verbatim)', 'Absorption', 'Distribution', 'Metabolism']);
type Cell = WorkbookRecord['cells'][number];
function CellTable({ cells, layer }: { cells: Cell[]; layer: 'records' | 'derived' }) {
  return <div className="cell-table-wrap"><table className="cell-table"><caption className="sr-only">{layer === 'records' ? 'Workbook' : 'Derived'} cells as imported</caption><thead><tr><th scope="col">Field</th><th scope="col">Cell</th><th scope="col">Value</th></tr></thead><tbody>{cells.map((cell) => <tr key={cell.cell}><th scope="row">{cell.field}</th><td><code>{layer === 'derived' ? 'Derived_NOT_ADCdb' : 'Records'}!{cell.cell}</code></td><td className={cell.value === null ? 'blank-cell' : ''}>{cell.value === null ? 'Unknown (blank cell)' : cell.value}</td></tr>)}</tbody></table></div>;
}

function RecordDetail({ record, onClose }: { record: WorkbookRecord; onClose: () => void }) {
  const sensitive = record.cells.filter((cell) => unverifiedFields.has(cell.field));
  return <section className="atlas-detail" aria-labelledby="atlas-detail-heading">
    <div className="section-heading"><h2 id="atlas-detail-heading">{record.brand ?? record.name}</h2><button className="icon-button" type="button" onClick={onClose} aria-label="Close record detail"><X size={16} aria-hidden="true" /></button></div>
    <p className="result-scope">{record.name}. <code>{record.id}</code>. Row {record.row}.</p>
    <p className="field-hint">{record.clinical_enabled ? 'Has a local UK label summary, so it can be used in Check a claim and Patient context.' : 'No local label summary. Research chat can check its workbook composition and ADCdb record; label and clinical questions return not enough evidence.'}</p>
    <CellTable cells={record.cells.filter((cell) => !unverifiedFields.has(cell.field))} layer="records" />
    {sensitive.length > 0 && <details className="unverified-disclosure"><summary>Toxicity and pharmacokinetic text ({sensitive.length} cells)</summary><p className="field-hint">Imported text as written in the workbook. It does not feed the clinical gate.</p><CellTable cells={sensitive} layer="records" /></details>}
    <p className="field-hint">{record.cells.length} cells. Blank: {record.missing_fields.join(', ') || 'none'}.</p>
  </section>;
}

export function AdcAtlas({ catalog }: { catalog: ResearchCatalog }) {
  const { dataset } = catalog;
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');
  const [layer, setLayer] = useState<'records' | 'derived'>('records');
  const [selectedId, setSelectedId] = useState<string | null>('DRG0ERKBH');
  const targetOptions = useMemo(() => [...new Set(dataset.records.map((record) => record.target))].sort(), [dataset]);
  const blanks = dataset.records.reduce((total, record) => total + record.cells.filter((cell) => cell.value === null).length, 0);
  const cells = dataset.records.reduce((total, record) => total + record.cells.length, 0);
  const derivedBlanks = dataset.derived_records.reduce((total, record) => total + record.cells.filter((cell) => cell.value === null).length, 0);
  const filtered = dataset.records.filter((record) => (!target || record.target === target)
    && [record.name, record.brand, record.id, record.target, record.payload].some((value) => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const selected = dataset.records.find((record) => record.id === selectedId);
  return <section className="atlas-view" aria-labelledby="atlas-heading">
    <header className="view-heading"><h1 id="atlas-heading">ADC table</h1><p>The workbook rows as imported: antibody, target, linker, payload and drug-to-antibody ratio. Blank cells stay blank. Derived notes are listed separately.</p></header>
    <dl className="atlas-totals"><div><dt>Records</dt><dd>{dataset.records.length}</dd></div><div><dt>Cells</dt><dd>{cells}</dd></div><div><dt>Blank cells</dt><dd>{blanks}</dd></div><div><dt>Derived rows</dt><dd>{dataset.derived_records.length}</dd></div><div><dt>With label summary</dt><dd>{dataset.records.filter((record) => record.clinical_enabled).length}</dd></div></dl>
    <div className="atlas-layer-controls" role="group" aria-label="Table layer"><button type="button" aria-pressed={layer === 'records'} className={layer === 'records' ? 'selected' : ''} onClick={() => setLayer('records')}>Workbook rows <span>{dataset.records.length}</span></button><button type="button" aria-pressed={layer === 'derived'} className={layer === 'derived' ? 'selected' : ''} onClick={() => setLayer('derived')}>Derived notes <span>{dataset.derived_records.length}</span></button></div>
    {layer === 'records' ? <>
      <div className="atlas-filters"><div className="field search-field"><label htmlFor="atlas-search">Search</label><div className="search-input"><Search size={15} aria-hidden="true" /><input type="search" id="atlas-search" value={query} placeholder="Name, id, target or payload" onChange={(event) => setQuery(event.target.value)} /></div></div><div className="field target-field"><label htmlFor="atlas-target">Target</label><select id="atlas-target" value={target} onChange={(event) => setTarget(event.target.value)}><option value="">All ({targetOptions.length})</option>{targetOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><button type="button" className="button button-secondary" onClick={() => { setQuery(''); setTarget(''); }} disabled={!query && !target}>Clear</button></div>
      <p className="atlas-count" role="status" aria-live="polite">{filtered.length} of {dataset.records.length} records. Select a name to see its cells.</p>
      <div className={`atlas-layout ${selected ? 'has-detail' : ''}`}><div className="atlas-table-wrap" tabIndex={0} role="region" aria-label="ADC workbook table, scrollable"><table className="atlas-table"><caption className="sr-only">Workbook records</caption><thead><tr><th scope="col">Name</th><th scope="col">Target</th><th scope="col">Payload</th></tr></thead><tbody>{filtered.map((record) => <tr key={record.id} className={selectedId === record.id ? 'selected-row' : ''}><th scope="row"><button type="button" onClick={() => setSelectedId(record.id)} aria-pressed={selectedId === record.id} aria-controls="record-detail-region">{record.name}<span>{record.brand ?? 'Brand unknown'}</span></button><code>{record.id}</code>{record.clinical_enabled && <span className="record-layer">Label summary</span>}</th><td>{record.target}</td><td>{record.payload ?? 'Unknown (blank cell)'}</td></tr>)}</tbody></table>{!filtered.length && <div className="empty-section-note">No records match. Clear the filters to see all rows.</div>}</div><div id="record-detail-region">{selected && <RecordDetail key={selected.id} record={selected} onClose={() => setSelectedId(null)} />}</div></div>
    </> : <section className="derived-layer" aria-labelledby="derived-heading"><h2 id="derived-heading">Derived notes</h2><p>Author notes kept on a separate sheet, <code>Derived_NOT_ADCdb</code>. They are tagged <code>derived_not_adcdb</code> and cannot be the only source for a claim.</p><blockquote>{dataset.derived_notice}</blockquote><p className="field-hint">{dataset.derived_records.length} rows, {derivedBlanks} blank cells, counted apart from the workbook totals.</p>{dataset.derived_records.map((record) => <details className="derived-record" key={record.id}><summary><code>{record.id}</code>, row {record.row}, {record.cells.length} cells</summary><CellTable cells={record.cells} layer="derived" /></details>)}</section>}
    {layer === 'records' && <AntibodyMap selectedId={selectedId} onSelect={setSelectedId} />}
    <section className="atlas-provenance" aria-labelledby="atlas-provenance-heading"><h2 id="atlas-provenance-heading">Where the table came from</h2><dl><div><dt>File</dt><dd><code>{dataset.filename}</code></dd></div><div><dt>Provenance</dt><dd><code>{dataset.provenance}</code></dd></div><div><dt>Imported</dt><dd>{dataset.imported_at}</dd></div><div><dt>Original extraction date</dt><dd>Unknown</dd></div><div><dt>SHA-256</dt><dd><code>{dataset.sha256}</code></dd></div></dl><ul>{dataset.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></section>
  </section>;
}

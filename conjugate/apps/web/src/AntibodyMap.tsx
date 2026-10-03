import { useMemo, useState } from 'react';
import embeddings from '../../../data/antibody_embeddings.json';

interface MapRecord { id: string; name: string; brand: string | null; target: string; payload: string | null; antibody_workbook: string; therasabdab_name: string; match_via: string; vh_length: number; vl_length: number; pc1: number; pc2: number }
interface Embeddings {
  generated_at: string; model: { id: string; revision: string; pooling: string; device: string };
  sequence_source: { name: string; url: string; sha256: string; note: string };
  workbook_sha256: string; matched_count: number; workbook_count: number;
  unmatched: { id: string; name: string; antibody: string; reason: string }[];
  pca_explained_variance: number[]; spearman_cosine_vs_identity: number;
  records: MapRecord[]; cosine: number[][]; identity: number[][];
}
const data = embeddings as unknown as Embeddings;
const isHer2 = (target: string) => /HER2|erbB-2/i.test(target);
const short = (record: MapRecord) => record.brand ?? record.antibody_workbook;

export function AntibodyMap({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const width = 640, height = 400, pad = 36;
  const scale = useMemo(() => {
    const xs = data.records.map((record) => record.pc1), ys = data.records.map((record) => record.pc2);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return { x: (value: number) => pad + ((value - x0) / (x1 - x0 || 1)) * (width - 2 * pad), y: (value: number) => height - pad - ((value - y0) / (y1 - y0 || 1)) * (height - 2 * pad) };
  }, []);
  const index = data.records.findIndex((record) => record.id === selectedId);
  const selected = index >= 0 ? data.records[index] : undefined;
  const neighbours = selected ? data.records.map((record, i) => ({ record, cosine: data.cosine[index]?.[i] ?? 0, identity: data.identity[index]?.[i] ?? 0 }))
    .filter((item) => item.record.id !== selected.id).sort((a, b) => b.cosine - a.cosine).slice(0, 6) : [];
  const [pc1, pc2] = data.pca_explained_variance;
  return <section className="antibody-map" aria-labelledby="antibody-map-heading">
    <h2 id="antibody-map-heading">Antibody sequence map</h2>
    <p>Exploratory. Each point is the antibody of one workbook row, embedded from its heavy and light variable-domain sequences with <code>{data.model.id}</code> and projected to two axes with PCA. Nearby points have similar sequences. Similar sequence does not mean similar binding, efficacy, safety or interchangeability, and nothing here feeds Check a claim.</p>
    <div className="antibody-map-layout">
      <div className="chart-scroll" tabIndex={0} role="region" aria-label="Antibody sequence map, scrollable">
        <svg className="scatter" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="scatter-title scatter-desc">
          <title id="scatter-title">PCA of antibody variable-domain embeddings</title>
          <desc id="scatter-desc">{data.records.length} antibodies. HER2-targeting antibodies are filled circles; others are hollow. The selected antibody is highlighted. Axis 1 explains {(pc1 ?? 0) * 100 | 0} percent of variance, axis 2 {(pc2 ?? 0) * 100 | 0} percent.</desc>
          <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="axis" /><line x1={pad} y1={pad} x2={pad} y2={height - pad} className="axis" />
          <text x={width - pad} y={height - 10} textAnchor="end" className="axis-label">PC1 ({Math.round((pc1 ?? 0) * 100)}% of variance)</text>
          <text x={12} y={pad - 10} className="axis-label">PC2 ({Math.round((pc2 ?? 0) * 100)}%)</text>
          {data.records.map((record) => {
            const active = record.id === selectedId || record.id === hover;
            return <g key={record.id} className={`point ${isHer2(record.target) ? 'her2' : ''} ${record.id === selectedId ? 'selected' : ''}`}
              onMouseEnter={() => setHover(record.id)} onMouseLeave={() => setHover(null)}>
              <circle cx={scale.x(record.pc1)} cy={scale.y(record.pc2)} r={active ? 7 : 5} tabIndex={0} role="button" aria-label={`${short(record)}, ${record.target}`} aria-pressed={record.id === selectedId}
                onClick={() => onSelect(record.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(record.id); } }} onFocus={() => setHover(record.id)} onBlur={() => setHover(null)} />
              {(active || isHer2(record.target)) && <text x={scale.x(record.pc1) + 9} y={scale.y(record.pc2) + 4} className="point-label">{short(record)}</text>}
            </g>;
          })}
        </svg>
      </div>
      <div className="antibody-neighbours">
        {selected ? <>
          <h3>Nearest to {short(selected)}</h3>
          <p className="field-hint">{selected.therasabdab_name} in Thera-SAbDab. VH {selected.vh_length}, VL {selected.vl_length} residues.</p>
          <table className="checks-table"><caption className="sr-only">Nearest antibodies by cosine similarity</caption>
            <thead><tr><th scope="col">Antibody</th><th scope="col">Target</th><th scope="col">Cosine</th><th scope="col">Seq. identity</th></tr></thead>
            <tbody>{neighbours.map((item) => <tr key={item.record.id}><td><button type="button" className="link-button" onClick={() => onSelect(item.record.id)}>{short(item.record)}</button></td><td>{item.record.target}</td><td>{item.cosine.toFixed(3)}</td><td>{(item.identity * 100).toFixed(0)}%</td></tr>)}</tbody>
          </table>
        </> : <p className="field-hint">Select a point, or a row in the table above, to see its nearest sequences. Rows without a Thera-SAbDab match have no point.</p>}
      </div>
    </div>
    <dl className="result-provenance">
      <div><dt>Model</dt><dd><code>{data.model.id}</code> at <code>{data.model.revision.slice(0, 12)}</code>, {data.model.pooling}</dd></div>
      <div><dt>Sequences</dt><dd><a href={data.sequence_source.url} target="_blank" rel="noopener noreferrer">{data.sequence_source.name}</a>, SHA-256 <code>{data.sequence_source.sha256.slice(0, 16)}</code>. {data.sequence_source.note}</dd></div>
      <div><dt>Matched</dt><dd>{data.matched_count} of {data.workbook_count} workbook rows. Not matched: {data.unmatched.map((item) => `${item.name} (${item.reason})`).join('; ')}.</dd></div>
      <div><dt>Cosine vs sequence identity</dt><dd>Spearman {data.spearman_cosine_vs_identity.toFixed(2)} across all pairs. The embedding mostly tracks sequence identity; it is not an independent signal about function.</dd></div>
      <div><dt>Generated</dt><dd>{data.generated_at}, by <code>scripts/embed_antibodies.py</code> on {data.model.device}</dd></div>
    </dl>
  </section>;
}

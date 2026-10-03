import { OrganFunctionSchema, type Catalog, type Engine } from '@her2/shared';
import { ChevronDown, Play, RotateCcw } from 'lucide-react';
import type { FormEvent } from 'react';
import type { HistoryValue, InputValues } from './boundaries';

type Props = {
  values: InputValues;
  engine: Engine;
  catalog: Catalog | null;
  busy: boolean;
  errors: Record<string, string>;
  onChange: <K extends keyof InputValues>(field: K, value: InputValues[K]) => void;
  onEngineChange: (engine: Engine) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
};

function historyValue(value: string): HistoryValue {
  return value === 'true' ? 'true' : value === 'false' ? 'false' : 'unknown';
}

function FieldError({ name, errors }: { name: string; errors: Record<string, string> }) {
  return errors[name] ? <span id={`${name}-error`} className="field-error">{errors[name]}</span> : null;
}

export function PatientForm({ values, engine, catalog, busy, errors, onChange, onEngineChange, onSubmit, onClear }: Props) {
  const claudeAvailable = catalog?.claude_configured === true && catalog.model === 'claude-opus-5-5';
  return (
    <section className="input-panel" aria-labelledby="input-heading">
      <h2 id="input-heading">Inputs</h2>
      <p className="field-hint">Made-up values only. A blank field means unknown, not normal.</p>
      <form onSubmit={onSubmit} noValidate autoComplete="off">
        <fieldset className="input-fields" disabled={!catalog}>
          <legend className="sr-only">Synthetic patient context</legend>
          <div className="field age-field">
            <label htmlFor="age">Age <span className="field-optional">optional</span></label>
            <div className="unit-input"><input id="age" name="age" type="number" min="18" max="120" step="1" placeholder="Unknown" value={values.age} onChange={(event) => onChange('age', event.target.value)} aria-invalid={Boolean(errors.age)} aria-describedby={errors.age ? 'age-error' : 'age-help'} /><span>years</span></div>
            <span className="field-hint" id="age-help">18 to 120</span>
            <FieldError name="age" errors={errors} />
          </div>
          <div className="field-grid">
            {(['renal', 'hepatic'] as const).map((field) => (
              <div className="field" key={field}>
                <label htmlFor={field}>{field === 'renal' ? 'Renal function' : 'Hepatic function'}</label>
                <div className="select-wrap"><select id={field} value={values[field]} onChange={(event) => onChange(field, OrganFunctionSchema.parse(event.target.value))} aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `${field}-error` : undefined}>
                  {OrganFunctionSchema.options.map((value) => <option key={value} value={value}>{value === 'unknown' ? 'Unknown' : value === 'normal' ? 'Normal' : `${value[0]?.toUpperCase()}${value.slice(1)}`}</option>)}
                </select><ChevronDown size={15} aria-hidden="true" /></div>
                <FieldError name={field} errors={errors} />
              </div>
            ))}
          </div>
          <div className="field-grid">
            {(['lung_history', 'neuropathy'] as const).map((field) => (
              <div className="field" key={field}>
                <label htmlFor={field}>{field === 'lung_history' ? 'Lung history' : 'Neuropathy'}</label>
                <div className="select-wrap"><select id={field} value={values[field]} onChange={(event) => onChange(field, historyValue(event.target.value))} aria-invalid={Boolean(errors[field])} aria-describedby={field === 'lung_history' ? 'lung-help' : undefined}>
                  <option value="unknown">Unknown</option><option value="true">Present</option><option value="false">Absent</option>
                </select><ChevronDown size={15} aria-hidden="true" /></div>
                <FieldError name={field} errors={errors} />
              </div>
            ))}
          </div>
          <p className="field-hint history-help" id="lung-help">Lung history covers interstitial lung disease or pneumonitis.</p>
          <details className="advanced-fields" open={Boolean(errors.platelets || errors.lvef || errors.neutrophils) || undefined}>
            <summary><span>Labs <span className="field-optional">optional</span></span><ChevronDown size={16} aria-hidden="true" /></summary>
            <div className="field-grid labs-grid">
              {([
                { field: 'platelets', label: 'Platelets', unit: '×10⁹/L', max: 2000 },
                { field: 'lvef', label: 'LVEF', unit: '%', max: 100 },
                { field: 'neutrophils', label: 'Neutrophils', unit: '×10⁹/L', max: 100 },
              ] as const).map(({ field, label, unit, max }) => (
                <div className="field" key={field}>
                  <label htmlFor={field}>{label}</label>
                  <div className="unit-input"><input id={field} type="number" min="0" max={max} step="any" placeholder="Unknown" value={values[field]} onChange={(event) => onChange(field, event.target.value)} aria-invalid={Boolean(errors[field])} aria-describedby={`${field}-unit${errors[field] ? ` ${field}-error` : ''}`} /><span id={`${field}-unit`}>{unit}</span></div>
                  <FieldError name={field} errors={errors} />
                </div>
              ))}
            </div>
          </details>
          <div className="field medication-field">
            <label htmlFor="medications">Medications <span className="field-optional">optional</span></label>
            <textarea id="medications" rows={3} placeholder="One per line, or comma separated" value={values.medications} onChange={(event) => onChange('medications', event.target.value)} maxLength={4000} aria-invalid={Boolean(errors.medications)} aria-describedby={errors.medications ? 'medications-error' : 'medications-help'} />
            <span className="field-hint" id="medications-help">Up to 30 names, 100 characters each. Names only.</span>
            <FieldError name="medications" errors={errors} />
          </div>
          <label className="check-row" htmlFor="medication_list_complete"><input id="medication_list_complete" type="checkbox" checked={values.medication_list_complete} onChange={(event) => onChange('medication_list_complete', event.target.checked)} /><span>This medication list is complete</span></label>
          <fieldset className="inline-options engine-section">
            <legend>Drafting</legend>
            <div className="inline-option-row" role="radiogroup" aria-label="Drafting">
              <label className={`option-chip ${engine === 'evidence' ? 'selected' : ''}`}><input type="radio" name="engine" value="evidence" checked={engine === 'evidence'} onChange={() => onEngineChange('evidence')} /><span>Rules only</span></label>
              <label className={`option-chip ${engine === 'claude' ? 'selected' : ''}`}><input type="radio" name="engine" value="claude" checked={engine === 'claude'} disabled={!claudeAvailable} onChange={() => onEngineChange('claude')} aria-describedby="claude-status" /><span>Claude (claude-opus-5-5)</span></label>
            </div>
            <p id="claude-status" className="field-hint">{!catalog ? 'Server configuration not loaded.' : !claudeAvailable ? 'Add ANTHROPIC_API_KEY on the server to enable.' : 'Claude picks flag and source ids only. The verifier never sees its prose.'}</p>
          </fieldset>
          <div className="confirmation">
            <label className="check-row" htmlFor="synthetic_confirmed"><input id="synthetic_confirmed" type="checkbox" checked={values.synthetic_confirmed} onChange={(event) => onChange('synthetic_confirmed', event.target.checked)} required aria-invalid={Boolean(errors.synthetic_confirmed)} aria-describedby={errors.synthetic_confirmed ? 'synthetic-help synthetic_confirmed-error' : 'synthetic-help'} /><span>This is synthetic research use. No patient data.</span></label>
            <p id="synthetic-help" className="field-hint">{engine === 'claude' ? 'These fields go to Anthropic through this server.' : 'These fields go to the local API only.'}</p>
            <FieldError name="synthetic_confirmed" errors={errors} />
          </div>
        </fieldset>
        <button className="button button-primary run-button" type="submit" disabled={busy || !catalog || catalog.products.length === 0 || !values.synthetic_confirmed}>{busy ? <span className="spinner" aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}<span>{busy ? 'Running' : 'Run review'}</span></button>
        <button className="text-button clear-inputs" type="button" onClick={onClear}><RotateCcw size={13} aria-hidden="true" /> Clear inputs</button>
      </form>
    </section>
  );
}

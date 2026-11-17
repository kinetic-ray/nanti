import { useEffect, useRef, useState } from 'react';
import { comparisonAlternatives, comparisonLimits, evaluateComparison } from '../shared/value-ranker.js';
import type { ComparisonInput, ComparisonResult, Criterion, Rating } from '../shared/value-ranker.js';
import type { SavedAssessment } from '../shared/intelligence.js';
import { formatPrice } from '../shared/wishlist.js';
import type { Wishlist } from '../shared/wishlist.js';
import { errorMessage } from './api.js';
import { History, ToolDialog, useAssessmentHistory } from './intelligence-ui.js';

const presets = [
  { name: 'Unit price', kind: 'price' },
  { name: 'Durability', kind: 'benefit' },
  { name: 'Features', kind: 'benefit' },
  { name: 'Performance', kind: 'benefit' },
  { name: 'Maintenance cost', kind: 'cost' },
  { name: 'Warranty', kind: 'benefit' },
  { name: 'Personal preference', kind: 'benefit' },
  { name: 'Long-term usefulness', kind: 'benefit' },
] as const;

export function ValueRanker({ list, path, close, drafts }: {
  list: Wishlist; path: string; close: () => void; drafts: Map<string, ComparisonInput>;
}) {
  const [input, setInput] = useState<ComparisonInput>(() => {
    const draft = drafts.get(path);
    if (draft) {
      const available = new Set(list.items.map(({ id }) => id));
      return { ...draft, alternatives: draft.alternatives.filter(({ itemId }) => available.has(itemId)) };
    }
    return { alternatives: [], criteria: [{ id: crypto.randomUUID(), weight: 1, ...presets[0] }] };
  });
  const [step, setStep] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [preset, setPreset] = useState('');
  const [viewed, setViewed] = useState<Extract<SavedAssessment, { kind: 'comparison' }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const focus = useRef<HTMLHeadingElement>(null);
  const history = useAssessmentHistory(`${path}/comparisons`);
  const result = viewed?.result ?? (showResult ? evaluateComparison(input.criteria, comparisonAlternatives(input, list.items)) : null);
  const products = new Map(list.items.map(({ id, name }) => [id, name]));
  const selected = new Set(input.alternatives.map(({ itemId }) => itemId));

  useEffect(() => { drafts.set(path, input); }, [drafts, path, input]);

  function edit(update: (current: ComparisonInput) => ComparisonInput) {
    setInput(update);
    setStatus('');
    setError('');
  }

  function selectProduct(itemId: string, checked: boolean) {
    edit((current) => ({ ...current, alternatives: checked ? [...current.alternatives, { itemId, ratings: {} }]
      : current.alternatives.filter((entry) => entry.itemId !== itemId) }));
  }

  function changeCriterion(id: string, update: Partial<Pick<Criterion, 'name' | 'weight' | 'kind'>>) {
    edit((current) => ({ ...current, criteria: current.criteria.map((entry) => entry.id === id ? { ...entry, ...update } : entry) }));
  }

  function removeCriterion(criterionId: string) {
    edit((current) => ({
      criteria: current.criteria.filter(({ id }) => id !== criterionId),
      alternatives: current.alternatives.map(({ itemId, ratings }) => ({
        itemId, ratings: Object.fromEntries(Object.entries(ratings).filter(([id]) => id !== criterionId)),
      })),
    }));
  }

  function addCriterion() {
    const template = presets.find(({ name }) => name === preset);
    const criterion: Criterion = { id: crypto.randomUUID(), weight: 1, ...(template ?? { name: '', kind: 'benefit' }) };
    edit((current) => ({ ...current, criteria: [...current.criteria, criterion] }));
    setPreset('');
  }

  function changeRating(itemId: string, criterionId: string, rating: Rating) {
    edit((current) => ({ ...current, alternatives: current.alternatives.map((entry) => entry.itemId === itemId
      ? { ...entry, ratings: { ...entry.ratings, [criterionId]: rating } } : entry) }));
  }

  function go(next: number) {
    setStep(next);
    setError('');
    requestAnimationFrame(() => focus.current?.focus());
  }

  async function save() {
    setError('');
    setBusy(true);
    try {
      const saved = await history.save(input);
      if (saved.kind === 'comparison') setViewed(saved);
      setStatus('Comparison saved.');
      requestAnimationFrame(() => focus.current?.focus());
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return <ToolDialog title="Value Ranker" context={list.name} module="comparison" version={result?.version} close={close} busy={busy} wide>
    {viewed ? <div className="decision-section">
      <h3 ref={focus} tabIndex={-1}>Saved comparison</h3>
      <p className="hint">Saved <time dateTime={viewed.createdAt}>{new Date(viewed.createdAt).toLocaleString()}</time></p>
      {viewed.input.alternatives.some(({ itemId }) => !products.has(itemId)) &&
        <p>Some products have been removed. Their saved values are still shown below.</p>}
      <div className="actions">
        <button type="button" onClick={() => { setViewed(null); setStatus(''); go(step); }}>Back to my comparison</button>
        <button type="button" onClick={() => {
          setInput({ ...viewed.input, alternatives: viewed.input.alternatives.filter(({ itemId }) => products.has(itemId)) });
          setViewed(null); setShowResult(false); setStatus(''); go(0);
        }}>Use these settings</button>
      </div>
    </div> : <form className="decision-section" onSubmit={(event) => {
      event.preventDefault();
      if (step === 2) setShowResult(true);
      go(Math.min(step + 1, 3));
    }}>
      {step === 0 ? <>
        <h3 ref={focus} tabIndex={-1}>Choose products</h3>
        <p className="hint">Select two to {comparisonLimits.alternatives} from this wishlist.</p>
        <fieldset className="product-options" aria-label="Products to compare" disabled={busy}>
          {list.items.map(({ id, name }) => <label key={id} className="check-label">
            <input type="checkbox" checked={selected.has(id)} disabled={!selected.has(id) && selected.size >= comparisonLimits.alternatives}
              onChange={(event) => selectProduct(id, event.target.checked)} />{name}
          </label>)}
        </fieldset>
      </> : step === 1 || step === 3 ? <>
        <h3 ref={focus} tabIndex={-1}>{step === 1 ? 'Choose criteria and weights' : 'Adjust your priorities'}</h3>
        <p className="hint">A larger weight gives a criterion more influence. Use 0 to leave it out of the ranking.</p>
        <fieldset className="criterion-list" disabled={busy}>
          {input.criteria.map((criterion, index) => <fieldset key={criterion.id} className="criterion">
            <legend>{criterion.name || 'Custom criterion'}</legend>
            {criterion.kind === 'price' ? <p className="hint">Uses the saved unit prices in {list.currency}.</p> : <>
              <label>Name<input required maxLength={comparisonLimits.name} value={criterion.name}
                onChange={(event) => changeCriterion(criterion.id, { name: event.target.value })} /></label>
              <label>Direction<select value={criterion.kind} onChange={(event) => changeCriterion(criterion.id,
                { kind: event.target.value === 'cost' ? 'cost' : 'benefit' })}>
                <option value="benefit">Benefit · higher is better</option><option value="cost">Cost · lower is better</option>
              </select></label>
            </>}
            <label>Weight for {criterion.name.trim() || `criterion ${index + 1}`}
              <input type="number" min={0} max={comparisonLimits.weight} step={1} value={criterion.weight} onChange={(event) => {
                const weight = event.target.valueAsNumber;
                if (Number.isInteger(weight) && weight >= 0 && weight <= comparisonLimits.weight) changeCriterion(criterion.id, { weight });
                if (event.target.value === '') changeCriterion(criterion.id, { weight: 0 });
              }} />
            </label>
            <button type="button" onClick={() => removeCriterion(criterion.id)} aria-label={`Remove criterion ${criterion.name || index + 1}`}>Remove</button>
          </fieldset>)}
          {input.criteria.length < comparisonLimits.criteria && <div className="actions add-criterion">
            <label>Add a criterion
              <select value={preset} onChange={(event) => setPreset(event.target.value)}>
                <option value="">Choose a criterion</option>
                {presets.filter((entry) => !input.criteria.some(({ name, kind }) => name === entry.name || (kind === 'price' && entry.kind === 'price')))
                  .map(({ name }) => <option key={name}>{name}</option>)}
                <option value="custom">Custom criterion</option>
              </select>
            </label>
            <button type="button" disabled={!preset} onClick={addCriterion}>Add criterion</button>
          </div>}
        </fieldset>
      </> : <>
        <h3 ref={focus} tabIndex={-1}>Enter ratings and evidence</h3>
        <p className="hint">Use the same 0–{comparisonLimits.rating} scale for each product on a criterion. Leave a rating blank if it’s unknown.</p>
        {input.criteria.every(({ kind }) => kind === 'price') ? <p>Saved unit prices are used automatically.</p> :
          <fieldset className="criterion-list" disabled={busy}>
            {input.alternatives.map(({ itemId, ratings }) => <fieldset key={itemId} className="criterion">
              <legend>{products.get(itemId)}</legend>
              {input.criteria.filter(({ kind }) => kind !== 'price').map(({ id, kind, name }) => {
                const rating = ratings[id] ?? { note: '', value: null };
                return <div key={id} className="rating-fields">
                  <label>{name} <span className="optional">{kind === 'cost' ? '(lower is better)' : '(higher is better)'}</span>
                    <input type="number" min={0} max={comparisonLimits.rating} step="any" value={rating.value ?? ''}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        if (Number.isFinite(value) && value >= 0 && value <= comparisonLimits.rating) changeRating(itemId, id, { ...rating, value });
                        if (!event.target.value) changeRating(itemId, id, { ...rating, value: null });
                      }} />
                  </label>
                  <label>Evidence for {name} <span className="optional">(optional)</span>
                    <input maxLength={comparisonLimits.note} value={rating.note}
                      onChange={(event) => changeRating(itemId, id, { ...rating, note: event.target.value })} />
                  </label>
                </div>;
              })}
            </fieldset>)}
          </fieldset>}
      </>}
      <div className="actions">
        {step > 0 && <button type="button" disabled={busy} onClick={() => go(step - 1)}>{step === 3 ? 'Edit ratings' : 'Back'}</button>}
        {step < 3 && <button className="primary" disabled={busy || selected.size < 2 ||
          (step > 0 && (!input.criteria.length || input.criteria.some(({ name }) => !name.trim())))}>
          {step === 0 ? 'Choose criteria' : step === 1 ? 'Enter ratings' : 'See comparison'}
        </button>}
        {step === 3 && <button type="button" className="primary" disabled={busy || history.busy || selected.size < 2 ||
          !input.criteria.length || input.criteria.some(({ name }) => !name.trim())} onClick={() => void save()}>Save comparison</button>}
      </div>
    </form>}
    {result && <ComparisonBreakdown result={result} input={viewed?.input ?? input} products={products} currency={list.currency} />}
    {error && <p role="alert" className="error">{error}</p>}
    <p className="decision-status" role="status">{status}</p>
    <History history={history} name="comparisons" disabled={busy} onSelect={(record) => {
      if (record.kind === 'comparison') {
        setViewed(record); setStatus(''); setError('');
        requestAnimationFrame(() => focus.current?.focus());
      }
    }} />
  </ToolDialog>;
}

function ComparisonBreakdown({ result, input, products, currency }: {
  result: ComparisonResult; input: ComparisonInput; products: Map<string, string>; currency: Wishlist['currency'];
}) {
  const byId = new Map(result.breakdown.map((entry) => [entry.id, entry]));
  const options = result.breakdown.map(({ id }) => id);
  const names = new Map(options.map((id, index) => [id, products.get(id) ?? `Removed product ${index + 1}`]));
  const rank = result.ranking;
  const weightSum = input.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const percent = (value: number) => `${Number((value * 100).toFixed(2))}%`;
  return <section className="decision-result">
    <h3>Comparison</h3>
    <p role="status">{rank ? (rank.filter(({ rank }) => rank === 1).length > 1
      ? `Tied for first: ${rank.filter(({ rank }) => rank === 1).map(({ id }) => names.get(id)).join(', ')}.`
      : `${names.get(rank[0]!.id)} ranks first at these weights.`)
      : result.status === 'no-weights' ? 'Give at least one criterion a positive weight to rank these products.'
      : result.status === 'not-enough-products' ? 'Choose at least two products to see a ranking.'
      : 'A ranking needs a value for each weighted criterion. Unknown values are marked in the table.'}</p>
    <div className="comparison-scroll" role="region" aria-label="Comparison table" tabIndex={0}>
      <table>
        <caption className="sr-only">Product values, weighted contributions and rankings</caption>
        <thead><tr><th scope="col">Criterion</th>{options.map((id) => <th key={id} scope="col">{names.get(id)}</th>)}</tr></thead>
        <tbody>
          {rank && <tr><th scope="row">Overall rank</th>{options.map((id) => {
            const entry = rank.find((candidate) => candidate.id === id)!;
            return <td key={id}><strong>{entry.rank}</strong> <small>({percent(entry.score)})</small></td>;
          })}</tr>}
          {input.criteria.map((criterion) => {
            const cells = options.map((id) => byId.get(id)?.criteria.find(({ id }) => id === criterion.id));
            const best = Math.max(...cells.map((cell) => cell?.normalized ?? -1));
            const distinguishable = cells.some((cell) => cell?.normalized !== null && cell?.normalized !== best);
            return <tr key={criterion.id}>
              <th scope="row">{criterion.name || 'Custom criterion'}
                <small>{criterion.kind === 'benefit' ? 'Higher is better' : 'Lower is better'} · {weightSum ? percent(criterion.weight / weightSum) : '0%'} weight</small>
              </th>
              {options.map((id, index) => {
                const cell = cells[index];
                const note = input.alternatives.find(({ itemId }) => itemId === id)?.ratings[criterion.id]?.note;
                return <td key={id}>
                  {cell?.input == null ? 'Unknown' : criterion.kind === 'price' ? formatPrice(cell.input, currency) : cell.input}
                  {cell?.normalized === best && distinguishable && <small>Best on this criterion</small>}
                  {cell?.contribution != null && <small>+{Number((cell.contribution * 100).toFixed(2))} points</small>}
                  {note && <small>{note}</small>}
                </td>;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <h4>Why this result?</h4>
    <p>The observed values set the scale for each criterion. Each product’s contribution depends on its position on that scale and the weight you chose. The table shows where the products trade off.</p>
    <h4>What happens if priorities change?</h4>
    {result.sensitivity.length > 0 ? <ul>{result.sensitivity.map(({ criterionId, weight, ranking }) =>
      <li key={`${criterionId}-${weight}`}>With {input.criteria.find(({ id }) => id === criterionId)?.name || 'this criterion'} at weight {weight},
        the order is {ranking.map(({ id, rank }) => `${rank}. ${names.get(id)}`).join(', ')}.</li>)}</ul>
      : <p>{rank ? 'Changing one weight to 0 or 100 did not change the order in the scenarios with enough information.'
        : 'Sensitivity is shown once the products can be ranked.'}</p>}
  </section>;
}

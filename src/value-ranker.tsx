import { useEffect, useRef, useState } from 'react';
import { comparisonAlternatives, comparisonLimits, evaluateComparison } from '../shared/value-ranker.js';
import type { ComparisonInput, ComparisonResult, Criterion, Rating } from '../shared/value-ranker.js';
import type { SavedAssessment } from '../shared/intelligence.js';
import type { Wishlist } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { History, ReviewDetails, ToolDialog, useAssessmentHistory } from './intelligence-ui.js';
import { useLocale } from './locale.js';
import type { Message } from './messages.js';

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

function criterionName(criterion: Criterion, t: (key: Message) => string) {
  const preset = criterion.preset ?? (criterion.kind === 'price' && criterion.name === 'Unit price' ? 'Unit price' : undefined);
  return preset ? t(preset) : criterion.name;
}

export function ValueRanker({ list, path, close, drafts }: {
  list: Wishlist; path: string; close: () => void; drafts: Map<string, ComparisonInput>;
}) {
  const { t, date, number, language, error: localError } = useLocale();
  const [input, setInput] = useState<ComparisonInput>(() => {
    const draft = drafts.get(path);
    if (draft) {
      const available = new Set(list.items.map(({ id }) => id));
      return { ...draft, alternatives: draft.alternatives.filter(({ itemId }) => available.has(itemId)) };
    }
    return { alternatives: [], criteria: [{ id: crypto.randomUUID(), weight: 1, ...presets[0], preset: 'Unit price' }] };
  });
  const [step, setStep] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [preset, setPreset] = useState('');
  const [viewed, setViewed] = useState<Extract<SavedAssessment, { kind: 'comparison' }> | null>(null);
  const [previous, setPrevious] = useState<Extract<SavedAssessment, { kind: 'comparison' }> | null>(null);
  const [liveItems, setLiveItems] = useState(list.items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<Message | ''>('');
  const focus = useRef<HTMLHeadingElement>(null);
  const history = useAssessmentHistory(`${path}/comparisons`);
  const result = viewed?.result ?? (showResult ? evaluateComparison(input.criteria, comparisonAlternatives(input, liveItems)) : null);
  const products = new Map(liveItems.map(({ id, name }) => [id, name]));
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
    edit((current) => ({ ...current, criteria: current.criteria.map((entry) => entry.id === id
      ? { ...entry, ...update, ...(update.name !== undefined && { preset: undefined }) } : entry) }));
  }

  function weightInput(criterion: Criterion, index: number) {
    return <label key={criterion.id}>{t('Weight for {name}', {
      name: criterionName(criterion, t).trim() || t('criterion {n}', { n: number(index + 1) }),
    })}
      <input type="number" min={0} max={comparisonLimits.weight} step={1} value={criterion.weight} onChange={(event) => {
        const weight = event.target.valueAsNumber;
        if (Number.isInteger(weight) && weight >= 0 && weight <= comparisonLimits.weight) changeCriterion(criterion.id, { weight });
        if (event.target.value === '') changeCriterion(criterion.id, { weight: 0 });
      }} />
    </label>;
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
    const criterion: Criterion = { id: crypto.randomUUID(), weight: 1, preset: template?.name, ...(template ?? { name: '', kind: 'benefit' }) };
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
      const expectedProducts = liveItems.filter(({ id }) => selected.has(id))
        .map(({ id, priceMinor, quantity }) => ({ id, priceMinor, quantity }));
      const saved = await history.save({ ...input, expectedProducts });
      if (saved.kind === 'comparison') setViewed(saved);
      setStatus('Comparison saved.');
      requestAnimationFrame(() => focus.current?.focus());
    } catch (failure) {
      const message = errorMessage(failure);
      setError(message);
      if (message === 'The saved products changed. Check again before saving.') {
        try {
          const current = await api<Wishlist>(`/wishlists/${list.id}`);
          const available = new Set(current.items.map(({ id }) => id));
          setLiveItems(current.items);
          setInput((value) => ({ ...value, alternatives: value.alternatives.filter(({ itemId }) => available.has(itemId)) }));
          setShowResult(false);
          setStep(0);
          requestAnimationFrame(() => focus.current?.focus());
        } catch (refreshFailure) { setError(errorMessage(refreshFailure)); }
      }
    } finally {
      setBusy(false);
    }
  }

  async function beginReview() {
    if (!viewed) return;
    setBusy(true);
    setError('');
    try {
      const current = await api<Wishlist>(`/wishlists/${list.id}`);
      const available = new Set(current.items.map(({ id }) => id));
      setLiveItems(current.items);
      setInput({ ...viewed.input, alternatives: viewed.input.alternatives.filter(({ itemId }) => available.has(itemId)) });
      setPrevious(viewed); setViewed(null); setShowResult(false); setStatus(''); go(0);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  return <ToolDialog title={t('Value Ranker')} context={list.name} module="comparison" version={result?.version} close={close} busy={busy} wide>
    {previous && <details className="review-details">
      <summary>{t('Previous result')}</summary>
      <ReviewDetails changes={[...(previous.review ?? []), ...(previous.input.alternatives.length !== selected.size ||
        previous.input.alternatives.some(({ itemId }) => !selected.has(itemId)) ? [{ kind: 'selection' as const }] : [])]}
        currency={list.currency} />
      <ComparisonBreakdown result={previous.result} input={previous.input}
        products={new Map(previous.snapshot?.products.map(({ id, name }) => [id, name]) ?? products)}
        currency={list.currency} />
    </details>}
    {previous && !viewed && <p className="hint">{t('Your previous result stays in history. Confirm the details before checking again.')}</p>}
    {viewed ? <div className="decision-section">
      <h3 ref={focus} tabIndex={-1}>{t('Saved comparison')}</h3>
      <p className="hint">{t('Saved {date}', { date: date(viewed.createdAt) })}</p>
      <ReviewDetails changes={viewed.review} currency={list.currency} />
      {viewed.input.alternatives.some(({ itemId }) => !products.has(itemId)) &&
        <p>{t('Some products have been removed. Their saved values are still shown below.')}</p>}
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => { setViewed(null); setPrevious(null); setStatus(''); go(step); }}>{t('Back to my comparison')}</button>
        <button type="button" disabled={busy || liveItems.length < 2} onClick={() => void beginReview()}>{t('Recheck with current data')}</button>
      </div>
    </div> : <form className="decision-section" noValidate onSubmit={(event) => {
      event.preventDefault();
      if (selected.size < 2 || (step > 0 && (!input.criteria.length || input.criteria.some(({ name }) => !name.trim())))) return;
      if (step === 2) setShowResult(true);
      go(Math.min(step + 1, 3));
    }}>
      {step === 0 ? <>
        <h3 ref={focus} tabIndex={-1}>{t('Choose products')}</h3>
        <p className="hint">{liveItems.length < 2 ? t('Add at least two products to start a comparison. You can still open saved results below.')
          : t('Select two to {max} from this wishlist.', { max: number(comparisonLimits.alternatives) })}</p>
        <fieldset className="product-options" aria-label={t('Products to compare')} disabled={busy || liveItems.length < 2}>
          {liveItems.map(({ id, name }) => <label key={id} className="check-label">
            <input type="checkbox" checked={selected.has(id)} disabled={!selected.has(id) && selected.size >= comparisonLimits.alternatives}
              onChange={(event) => selectProduct(id, event.target.checked)} />{name}
          </label>)}
        </fieldset>
      </> : step === 3 ? <>
        <h3 ref={focus} tabIndex={-1}>{t('Adjust your priorities')}</h3>
        <fieldset className="weight-list" aria-label={t('Comparison weights')} disabled={busy}>
          {input.criteria.map(weightInput)}
        </fieldset>
      </> : step === 1 ? <>
        <h3 ref={focus} tabIndex={-1}>{t('Choose criteria and weights')}</h3>
        <p className="hint">{t('A larger weight gives a criterion more influence. Use 0 to leave it out of the ranking.')}</p>
        <fieldset className="criterion-list" disabled={busy}>
          {input.criteria.map((criterion, index) => <fieldset key={criterion.id} className="criterion">
            <legend>{criterionName(criterion, t) || t('Custom criterion')}</legend>
            {criterion.kind === 'price' ? <p className="hint">{t('Uses the saved unit prices in {currency}.', { currency: list.currency })}</p> : <>
              <label>{t('Name')}<input required maxLength={comparisonLimits.name} value={criterionName(criterion, t)}
                onChange={(event) => changeCriterion(criterion.id, { name: event.target.value })} /></label>
              <label>{t('Direction')}<select value={criterion.kind} onChange={(event) => changeCriterion(criterion.id,
                { kind: event.target.value === 'cost' ? 'cost' : 'benefit' })}>
                <option value="benefit">{t('Benefit · higher is better')}</option><option value="cost">{t('Cost · lower is better')}</option>
              </select></label>
            </>}
            {weightInput(criterion, index)}
            <button type="button" onClick={() => removeCriterion(criterion.id)}
              aria-label={t('Remove criterion {name}', { name: criterionName(criterion, t) || number(index + 1) })}>{t('Remove')}</button>
          </fieldset>)}
          {input.criteria.length < comparisonLimits.criteria && <div className="actions add-criterion">
            <label>{t('Add a criterion')}
              <select value={preset} onChange={(event) => setPreset(event.target.value)}>
                <option value="">{t('Choose a criterion')}</option>
                {presets.filter((entry) => !input.criteria.some(({ name, kind }) => name === entry.name || (kind === 'price' && entry.kind === 'price')))
                  .map(({ name }) => <option key={name} value={name}>{t(name)}</option>)}
                <option value="custom">{t('Custom criterion')}</option>
              </select>
            </label>
            <button type="button" disabled={!preset} onClick={addCriterion}>{t('Add criterion')}</button>
          </div>}
        </fieldset>
      </> : <>
        <h3 ref={focus} tabIndex={-1}>{t('Enter ratings and evidence')}</h3>
        <p className="hint">{t('Use the same 0–{max} scale for each product on a criterion. Leave a rating blank if it’s unknown.', { max: number(comparisonLimits.rating) })}</p>
        {input.criteria.every(({ kind }) => kind === 'price') ? <p>{t('Saved unit prices are used automatically.')}</p> :
          <fieldset className="criterion-list" disabled={busy}>
            {input.alternatives.map(({ itemId, ratings }) => <fieldset key={itemId} className="criterion">
              <legend>{products.get(itemId)}</legend>
              {input.criteria.filter(({ kind }) => kind !== 'price').map((criterion) => {
                const { id, kind } = criterion;
                const name = criterionName(criterion, t);
                const rating = ratings[id] ?? { note: '', value: null };
                return <div key={id} className="rating-fields">
                  <label>{name} <span className="optional">{t(kind === 'cost' ? '(lower is better)' : '(higher is better)')}</span>
                    <input lang={language} type="number" min={0} max={comparisonLimits.rating} step="any" value={rating.value ?? ''}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        if (Number.isFinite(value) && value >= 0 && value <= comparisonLimits.rating) changeRating(itemId, id, { ...rating, value });
                        if (!event.target.value) changeRating(itemId, id, { ...rating, value: null });
                      }} />
                  </label>
                  <label>{t('Evidence for {name}', { name })} <span className="optional">{t('(optional)')}</span>
                    <input maxLength={comparisonLimits.note} value={rating.note}
                      onChange={(event) => changeRating(itemId, id, { ...rating, note: event.target.value })} />
                  </label>
                </div>;
              })}
            </fieldset>)}
          </fieldset>}
      </>}
      <div className="actions">
        {step === 3 && <button type="button" disabled={busy} onClick={() => go(1)}>{t('Edit criteria')}</button>}
        {step > 0 && <button type="button" disabled={busy} onClick={() => go(step - 1)}>{t(step === 3 ? 'Edit ratings' : 'Back')}</button>}
        {step < 3 && <button className="primary" disabled={busy || selected.size < 2 ||
          (step > 0 && (!input.criteria.length || input.criteria.some(({ name }) => !name.trim())))}>
          {t(step === 0 ? 'Choose criteria' : step === 1 ? 'Enter ratings' : 'See comparison')}
        </button>}
        {step === 3 && <button type="button" className="primary" disabled={busy || history.busy || selected.size < 2 ||
          !input.criteria.length || input.criteria.some(({ name }) => !name.trim())} onClick={() => void save()}>{t('Save comparison')}</button>}
      </div>
    </form>}
    {result && <ComparisonBreakdown result={result} input={viewed?.input ?? input}
      products={viewed?.snapshot ? new Map(viewed.snapshot.products.map(({ id, name }) => [id, name])) : products}
      currency={list.currency} title={previous ? 'Current result' : 'Comparison'} />}
    {error && <p role="alert" className="error">{localError(error)}</p>}
    <p className="decision-status" role="status">{status && t(status)}</p>
    <History history={history} name="Saved comparisons" initialOpen={liveItems.length < 2} disabled={busy} onDelete={(id) => {
      if (viewed?.id === id) setViewed(null);
      if (previous?.id === id) setPrevious(null);
      setStatus('Comparison deleted.');
    }} onSelect={(record) => {
      if (record.kind === 'comparison') {
        setViewed(record); setPrevious(null); setStatus(''); setError('');
        requestAnimationFrame(() => focus.current?.focus());
      }
    }} />
  </ToolDialog>;
}

function ComparisonBreakdown({ result, input, products, currency, title = 'Comparison' }: {
  result: ComparisonResult; input: ComparisonInput; products: Map<string, string>; currency: Wishlist['currency'];
  title?: 'Comparison' | 'Current result';
}) {
  const { t, number, percent, money } = useLocale();
  const byId = new Map(result.breakdown.map((entry) => [entry.id, entry]));
  const options = result.breakdown.map(({ id }) => id);
  const names = new Map(options.map((id, index) => [id, products.get(id) ?? t('Removed product {n}', { n: number(index + 1) })]));
  const rank = result.ranking;
  const weightSum = input.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const leader = rank?.[0];
  const runnerUp = rank?.[1];
  const lead = leader && runnerUp && leader.rank !== runnerUp.rank ? input.criteria
    .map((criterion) => {
      const contribution = (id: string) => byId.get(id)?.criteria.find((entry) => entry.id === criterion.id)?.contribution ?? 0;
      return { criterion, difference: contribution(leader.id) - contribution(runnerUp.id) };
    }).sort((left, right) => right.difference - left.difference)[0] : undefined;
  return <section className="decision-result">
    <h3>{t(title)}</h3>
    <p role="status">{rank ? (rank.filter(({ rank }) => rank === 1).length > 1
      ? t('Tied for first: {names}.', { names: rank.filter(({ rank }) => rank === 1).map(({ id }) => names.get(id)).join(', ') })
      : t('{name} ranks first at these weights.', { name: names.get(rank[0]!.id)! }))
      : t(result.status === 'no-weights' ? 'Give at least one criterion a positive weight to rank these products.'
        : result.status === 'not-enough-products' ? 'Choose at least two products to see a ranking.'
        : 'A ranking needs a value for each weighted criterion. Unknown values are marked in the table.')}</p>
    {lead && leader && runnerUp && lead.difference > 0 && <p>{t('{name} gains the most ground over {other} on {criterion}.', {
      name: names.get(leader.id)!, other: names.get(runnerUp.id)!, criterion: criterionName(lead.criterion, t),
    })}</p>}
    {result.status === 'missing-data' && input.criteria.some(({ id, kind, weight }) => kind === 'price' && weight > 0 &&
      result.breakdown.some(({ criteria }) => criteria.some((cell) => cell.id === id && cell.input === null))) &&
      <p className="hint">{t('Add missing unit prices to the saved products or set the price weight to 0.')}</p>}
    <div className="comparison-scroll" role="region" aria-label={t('Comparison table')} tabIndex={0}>
      <table>
        <caption className="sr-only">{t('Product values, weighted contributions and rankings')}</caption>
        <thead><tr><th scope="col">{t('Criterion')}</th>{options.map((id) => <th key={id} scope="col">{names.get(id)}</th>)}</tr></thead>
        <tbody>
          {rank && <tr><th scope="row">{t('Overall rank')}</th>{options.map((id) => {
            const entry = rank.find((candidate) => candidate.id === id)!;
            return <td key={id}><strong>{number(entry.rank)}</strong> <small>({percent(entry.score)})</small></td>;
          })}</tr>}
          {input.criteria.map((criterion) => {
            const cells = options.map((id) => byId.get(id)?.criteria.find(({ id }) => id === criterion.id));
            const best = Math.max(...cells.map((cell) => cell?.normalized ?? -1));
            const distinguishable = cells.some((cell) => cell?.normalized !== null && cell?.normalized !== best);
            return <tr key={criterion.id}>
              <th scope="row">{criterionName(criterion, t) || t('Custom criterion')}
                <small>{t(criterion.kind === 'benefit' ? 'Higher is better' : 'Lower is better')} · {t('{value} weight', {
                  value: percent(weightSum ? criterion.weight / weightSum : 0),
                })}</small>
              </th>
              {options.map((id, index) => {
                const cell = cells[index];
                const note = input.alternatives.find(({ itemId }) => itemId === id)?.ratings[criterion.id]?.note;
                return <td key={id}>
                  {cell?.input == null ? t('Unknown') : criterion.kind === 'price' ? money(cell.input, currency) : number(cell.input)}
                  {cell?.normalized === best && distinguishable && <small>{t('Best on this criterion')}</small>}
                  {cell?.contribution != null && <small>{t('+{n} points', { n: number(Number((cell.contribution * 100).toFixed(2))) })}</small>}
                  {note && <small>{note}</small>}
                </td>;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <h4>{t('Why this result?')}</h4>
    <p>{t('The observed values set the scale for each criterion. Each product’s contribution depends on its position on that scale and the weight you chose. The table shows where the products trade off.')}</p>
    <h4>{t('What happens if priorities change?')}</h4>
    {result.sensitivity.length > 0 ? <ul>{result.sensitivity.map(({ criterionId, weight, ranking }) => {
      const criterion = input.criteria.find(({ id }) => id === criterionId);
      return <li key={`${criterionId}-${weight}`}>{t('With {criterion} at weight {weight}, the order is {order}.', {
        criterion: criterion ? criterionName(criterion, t) : t('Criterion'), weight: number(weight),
        order: ranking.map(({ id, rank }) => `${number(rank)}. ${names.get(id)}`).join(', '),
      })}</li>;
    })}</ul>
      : <p>{t(rank ? 'Changing one weight to 0 or 100 did not change the order in the scenarios with enough information.'
        : 'Sensitivity is shown once the products can be ranked.')}</p>}
  </section>;
}

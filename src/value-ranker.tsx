import { useEffect, useId, useRef, useState } from 'react';
import { isPriority } from '../shared/intelligence.js';
import type { SavedAssessment } from '../shared/intelligence.js';
import { priorityFactors, priorityLimit, rankPriorities } from '../shared/priorities.js';
import type { PriorityFactor, PriorityInput, PriorityRatings, PriorityResult } from '../shared/priorities.js';
import type { ComparisonInput, ComparisonResult, Criterion } from '../shared/value-ranker.js';
import type { Wishlist, WishlistSummary } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { History, ReviewDetails, ToolDialog, useAssessmentHistory } from './intelligence-ui.js';
import { useLocale } from './locale.js';
import type { Message } from './messages.js';

const labels = {
  usefulness: 'Usefulness',
  urgency: 'Urgency',
  affordability: 'Fits your budget',
  preference: 'How much you want it',
} as const;
const options = {
  usefulness: ['Rarely useful', 'Useful sometimes', 'Useful often'],
  urgency: ['Can wait', 'Useful soon', 'Needed soon'],
  affordability: ['Too tight', 'Not sure yet', 'Fits my budget'],
  preference: ['Nice to have', 'I like it', 'I really want it'],
} as const;

type ComparisonRecord = Extract<SavedAssessment, { kind: 'comparison' }>;
type Choice = Wishlist['items'][number] & { wishlist: WishlistSummary; ratings: Partial<PriorityRatings> };

function criterionName(criterion: Criterion, t: (key: Message) => string) {
  const preset = criterion.preset ?? (criterion.kind === 'price' && criterion.name === 'Unit price' ? 'Unit price' : undefined);
  return preset ? t(preset) : criterion.name;
}

export function ValueRanker({ list, lists, path, close }: {
  list: Wishlist; lists: WishlistSummary[]; path: string; close: () => void;
}) {
  const { t, money, date, number, error: localError } = useLocale();
  const [source, setSource] = useState(list.id);
  const [loaded, setLoaded] = useState<Wishlist | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sourceError, setSourceError] = useState('');
  const [choices, setChoices] = useState<Choice[]>([]);
  const [emphasis, setEmphasis] = useState<PriorityFactor | null>(null);
  const [step, setStep] = useState<'choose' | 'rate' | 'result'>('choose');
  const [viewed, setViewed] = useState<ComparisonRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<Message | ''>('');
  const heading = useRef<HTMLHeadingElement>(null);
  const wishlistLabel = useId();
  const history = useAssessmentHistory(`${path}/comparisons`);
  const current = loaded?.id === source ? loaded : source === list.id ? list : null;
  const complete = choices.length > 0 && choices.every(({ ratings }) => priorityFactors.every((key) => ratings[key] !== undefined));
  const input: PriorityInput | null = complete ? { mode: 'priorities', emphasis,
    alternatives: choices.map(({ wishlist, id, ratings }) => ({ wishlistId: wishlist.id, itemId: id, ratings: ratings as PriorityRatings })),
  } : null;
  const names = new Map((viewed ? viewed.snapshot?.products ?? list.items : choices).map(({ id, name }) => [id, name]));

  useEffect(() => {
    if (!source || source === list.id) return;
    const controller = new AbortController();
    api<Wishlist>(`/wishlists/${source}`, { signal: controller.signal }).then(setLoaded, (failure) => {
      if (!controller.signal.aborted) setSourceError(errorMessage(failure));
    });
    return () => controller.abort();
  }, [source, list.id, attempt]);

  function focusStep() {
    requestAnimationFrame(() => heading.current?.focus());
  }

  function go(next: typeof step) {
    setStep(next);
    setViewed(null);
    setError('');
    setStatus('');
    focusStep();
  }

  async function save() {
    if (!input) return;
    setBusy(true);
    setError('');
    try {
      const saved = await history.save({ ...input, expectedProducts: choices.map(({ id, priceMinor, quantity }) => ({ id, priceMinor, quantity })) });
      if (saved.kind === 'comparison') setViewed(saved);
      setStatus('Decision saved.');
      focusStep();
    } catch (failure) {
      const message = errorMessage(failure);
      setError(message);
      if (message === 'The saved products changed. Check again before saving.' ||
          message === 'This wishlist, product, or assessment could not be found.') setOutdated(true);
    } finally {
      setBusy(false);
    }
  }

  async function reselect() {
    setBusy(true);
    try {
      const ids = [...new Set([...choices.map(({ wishlist }) => wishlist.id), source])];
      const fresh = await Promise.all(ids.map(async (id) => {
        return api<Wishlist>(`/wishlists/${id}`).catch(() => null);
      }));
      setChoices(choices.flatMap(({ wishlist, id, ratings }) => {
        const currentList = fresh.find((entry) => entry?.id === wishlist.id);
        const entry = currentList?.items.find((item) => item.id === id);
        return currentList && entry ? [{ ...entry, wishlist: currentList, ratings }] : [];
      }));
      setLoaded(fresh.find((entry) => entry?.id === source) ?? null);
      setOutdated(false);
      go('choose');
    } finally {
      setBusy(false);
    }
  }

  const result = !viewed && step === 'result' && input ? rankPriorities(input) : null;
  return <ToolDialog title={t('Compare priorities')} context={viewed ? list.name : t('Your wishlists')} module="comparison" wide
    version={viewed?.version} close={close} busy={busy}>
    {viewed ? <section className="decision-section">
      <h3 ref={heading} tabIndex={-1}>{t('Previous decision')}</h3>
      <p className="hint">{t('Last checked {date}', { date: date(viewed.createdAt) })}</p>
      {isPriority(viewed) ? <PriorityOutcome result={viewed.result} names={names} /> :
        <ComparisonBreakdown result={viewed.result} input={viewed.input} products={names} currency={list.currency} />}
      <ReviewDetails changes={viewed.review} currency={list.currency} />
      <button type="button" className="primary" onClick={() => go('choose')}>{t('Check again')}</button>
    </section> : step === 'choose' ? <section className="decision-section priority-choose">
      <h3 ref={heading} tabIndex={-1}>{t('What are you deciding between?')}</h3>
      <p className="hint">{t('Choose up to {n} items from your wishlists. One item is fine, too.', { n: number(priorityLimit) })}</p>
      {lists.length > 1 && <label><span id={wishlistLabel}>{t('Wishlist')}</span><select
        aria-labelledby={wishlistLabel} value={source} onChange={(event) => {
        setSource(event.target.value); setSourceError(''); setLoaded(null);
      }}>
        {lists.map((wishlist) => <option key={wishlist.id} value={wishlist.id}>{wishlist.name}</option>)}
      </select></label>}
      {sourceError && <div><p role="alert" className="error">{localError(sourceError)}</p>
        <button type="button" onClick={() => { setSourceError(''); setAttempt((value) => value + 1); }}>{t('Try again')}</button></div>}
      {!current && !sourceError && <p role="status">{t('Working…')}</p>}
      {current?.items.length === 0 && <p className="hint">{t('No products yet')}</p>}
      <div className="product-options">
        {current?.items.map((item) => {
          const chosen = choices.some(({ id }) => id === item.id);
          return <label key={item.id} className="check-label">
            <input type="checkbox" checked={chosen} disabled={!chosen && choices.length >= priorityLimit}
              onChange={() => setChoices((previous) => chosen ? previous.filter(({ id }) => id !== item.id) :
                [...previous, { ...item, wishlist: current, ratings: {} }])} />
            <span>{item.name}</span>
          </label>;
        })}
      </div>
      {choices.length > 0 && <p className="hint">{t('Selected: {items}', { items: choices.map(({ name }) => name).join(', ') })}</p>}
      <div className="priority-choose-actions"><button type="button" className="primary" disabled={!choices.length} onClick={() => go('rate')}>{t('Set priorities')}</button></div>
    </section> : step === 'rate' ? <form className="decision-section" onSubmit={(event) => { event.preventDefault(); go('result'); }}>
      <h3 ref={heading} tabIndex={-1}>{t('How does each item fit?')}</h3>
      {choices.map((item) => <fieldset className="priority-item" key={item.id}>
        <legend>{item.name}</legend>
        <p className="hint">{item.wishlist.name} · {item.priceMinor === null ? t('Price unknown')
          : money((BigInt(item.priceMinor) * BigInt(item.quantity)).toString(), item.wishlist.currency)}</p>
        <div className="priority-ratings">{priorityFactors.map((factor) => <label key={factor}>{t(labels[factor])}
          <select required value={item.ratings[factor] ?? ''} onChange={(event) => {
            const rating = event.target.value === '' ? undefined : Number(event.target.value);
            setChoices((previous) => previous.map((choice) => choice.id === item.id
              ? { ...choice, ratings: { ...choice.ratings, [factor]: rating } } : choice));
          }}>
            <option value="">{t('Choose an answer')}</option>
            {options[factor].map((option, index) => <option key={option} value={index}>{t(option)}</option>)}
          </select>
        </label>)}</div>
      </fieldset>)}
      <label>{t('What matters most?')}<select value={emphasis ?? ''} onChange={(event) =>
        setEmphasis((event.target.value || null) as PriorityFactor | null)}>
        <option value="">{t('Everything equally')}</option>
        {priorityFactors.map((factor) => <option key={factor} value={factor}>{t(labels[factor])}</option>)}
      </select></label>
      <div className="actions">
        <button type="button" onClick={() => go('choose')}>{t('Back')}</button>
        <button className="primary" disabled={!complete}>{t('See priorities')}</button>
      </div>
    </form> : result && <section className="decision-result">
      <h3 ref={heading} tabIndex={-1}>{t(choices.length === 1 ? 'Your priority check' : 'What could come first')}</h3>
      <PriorityOutcome result={result} names={names} />
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => outdated ? void reselect() : go('rate')}>
          {t(outdated ? 'Check again' : 'Edit answers')}
        </button>
        {!outdated && <button type="button" className="primary" disabled={busy || history.busy} onClick={() => void save()}>{t('Save decision')}</button>}
      </div>
    </section>}
    {error && <p role="alert" className="error">{localError(error)}</p>}
    <p role="status" className="decision-status">{status && t(status)}</p>
    <History history={history} name="Previous decisions" disabled={busy}
      onSelect={(record) => { if (record.kind === 'comparison') { setViewed(record); setStatus(''); setError(''); focusStep(); } }}
      onDelete={(id) => { if (viewed?.id === id) go('choose'); setStatus('Assessment deleted.'); }} />
  </ToolDialog>;
}

function PriorityOutcome({ result, names }: { result: PriorityResult; names: Map<string, string> }) {
  const { t } = useLocale();
  return <>
    {result.ranking.length > 1 && result.ranking[0]?.score === result.ranking[1]?.score &&
      <p>{t('Your top choices are tied. Look at what matters most to you before deciding.')}</p>}
    <ul className="priority-results">{result.ranking.map((entry) => <li key={entry.id}>
      <strong>{result.ranking.length > 1 && <>{entry.rank}. </>}{names.get(entry.id) ?? t('Product')}</strong>
      {entry.strengths.length > 0 && <p>{t('What stands out: {factors}', {
        factors: entry.strengths.map((key) => t(labels[key])).join(', '),
      })}</p>}
      <p>{t(entry.needsTime ? 'Give your budget a closer look before buying.' : entry.score === 0 || entry.strengths.length <= 1
        ? 'It can stay on your wishlist until it feels like a priority.' : 'Keep it in mind when you’re ready to buy.')}</p>
    </li>)}</ul>
    <p className="hint">{t('Based on your answers and what matters to you. You can change your mind.')}</p>
  </>;
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
  return <section className="decision-result" data-outcome={result.status}>
    <h3>{t(title)}</h3>
    <p role="status" className="result-lead">{rank ? (rank.filter(({ rank }) => rank === 1).length > 1
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
    <details className="result-explanation">
      <summary>{t('What happens if priorities change?')}</summary>
    {result.sensitivity.length > 0 ? <ul>{result.sensitivity.map(({ criterionId, weight, ranking }) => {
      const criterion = input.criteria.find(({ id }) => id === criterionId);
      return <li key={`${criterionId}-${weight}`}>{t('With {criterion} at weight {weight}, the order is {order}.', {
        criterion: criterion ? criterionName(criterion, t) : t('Criterion'), weight: number(weight),
        order: ranking.map(({ id, rank }) => `${number(rank)}. ${names.get(id)}`).join(', '),
      })}</li>;
    })}</ul>
      : <p>{t(rank ? 'Changing one weight to 0 or 100 did not change the order in the scenarios with enough information.'
        : 'Sensitivity is shown once the products can be ranked.')}</p>}
    </details>
  </section>;
}

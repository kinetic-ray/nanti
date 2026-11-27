import { useId, type Dispatch, type SetStateAction } from 'react';
import { creditProviders } from '../shared/decision-engine/credit-rate-registry.js';
import { useLocale } from './locale.js';

export const initialFinancing = {
  provider: '', tier: '', months: '', downPayment: '0', actual: '', manual: false,
  rate: '', zeroInterest: false, discount: '', discountConfirmed: false, feeRate: '', fee: '',
};

type Financing = typeof initialFinancing;

export function financingSelection(draft: Financing) {
  const provider = creditProviders.find(entry => entry.id === draft.provider);
  const account = provider?.accounts.length === 1 ? provider.accounts[0]
    : provider?.accounts.find(entry => entry.id === draft.tier);
  const term = account?.terms.find(entry => entry.months === Number(draft.months));
  return { provider, account, term, manual: draft.manual || account?.method === 'manual' };
}

export function CreditFinancingFields({ draft, setDraft, message, invalid, formatAmount }: {
  draft: Financing;
  setDraft: Dispatch<SetStateAction<Financing>>;
  message: string | null;
  invalid: boolean;
  formatAmount: (value: string) => string;
}) {
  const { language, locale, date } = useLocale();
  const copy = (id: string, en: string) => language === 'id' ? id : en;
  const { provider, account, term, manual } = financingSelection(draft);
  const validationId = useId();
  const update = (patch: Partial<Financing>) => setDraft(current => ({ ...current, ...patch }));
  const resetOffer = { actual: '', zeroInterest: false, feeRate: '', fee: '', discount: '', discountConfirmed: false };
  const resetTerms = { ...resetOffer, months: '', rate: '' };
  const currencyField = (key: 'downPayment' | 'actual' | 'discount' | 'fee', label: string) => (
    <label className="decision-v2-field">
      {label}
      <input inputMode="numeric" value={formatAmount(draft[key])}
        aria-invalid={invalid && key === 'actual' || undefined}
        aria-describedby={key === 'actual' && message ? validationId : undefined}
        onChange={event => update({
          [key]: event.target.value.replace(/\D/g, '').slice(0, 12),
          ...(key === 'discount' && { discountConfirmed: false }),
        })} />
    </label>
  );

  return (
    <div className="decision-v2-credit-form">
      <label className="decision-v2-field">
        {copy('Penyedia pembiayaan', 'Financing provider')}
        <select value={draft.provider} onChange={event => update({
          ...resetTerms, provider: event.target.value, tier: '', manual: false,
        })}>
          <option value="">{copy('Pilih penyedia', 'Choose a provider')}</option>
          {creditProviders.map(entry => <option key={entry.id} value={entry.id}>
            {entry.id === 'other' ? copy('Pembiayaan lain', 'Other financing') : entry.name}
          </option>)}
        </select>
      </label>
      {provider && provider.accounts.length > 1 && (
        <label className="decision-v2-field">
          {copy('Jenis akun', 'Account tier')}
          <select value={draft.tier} onChange={event => update({ ...resetTerms, tier: event.target.value })}>
            <option value="">{copy('Pilih jenis akun', 'Choose an account tier')}</option>
            {provider.accounts.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
      )}
      {account && <>
        <div className="decision-v2-terms">
          <label className="decision-v2-field">
            {copy('Tenor (bulan)', 'Term (months)')}
            {account.terms.length ? (
              <select value={draft.months} onChange={event => update({
                ...resetOffer, months: event.target.value,
              })}>
                <option value="">{copy('Pilih tenor', 'Choose a term')}</option>
                {account.terms.map(entry => <option key={entry.months} value={entry.months}>{entry.months}</option>)}
              </select>
            ) : (
              <input inputMode="numeric" value={draft.months} onChange={event => update({
                ...resetOffer, months: event.target.value.replace(/\D/g, '').slice(0, 12),
              })} />
            )}
          </label>
          {currencyField('downPayment', copy('Uang muka (Rp)', 'Down payment (Rp)'))}
        </div>
        {manual && currencyField('actual', copy('Cicilan aktual per bulan (Rp)', 'Actual monthly installment (Rp)'))}
        {message && <p id={validationId} className={invalid ? 'credit-validation' : 'hint'} role={invalid ? 'alert' : undefined}>{message}</p>}
      </>}
      {(account || provider?.reference) && <div className="credit-form-actions">
        {account && account.method !== 'manual' && (
          <button className="decision-v2-text-action" type="button" onClick={() => update({ manual: !draft.manual, actual: '' })}>
            {manual ? copy('Gunakan estimasi', 'Use estimate') : copy('Masukkan cicilan aktual', 'Enter actual installment')}
          </button>
        )}
        {account && (
        <details className="credit-offer-options">
          <summary>{manual ? copy('Potongan promo', 'Promotional discount') : copy('Promo dan biaya', 'Promotions and fees')}</summary>
          {currencyField('discount', copy('Potongan harga transaksi (Rp)', 'Transaction discount (Rp)'))}
          {Number(draft.discount) > 0 && (
            <label className="credit-option-check">
              <input type="checkbox" checked={draft.discountConfirmed}
                onChange={event => update({ discountConfirmed: event.target.checked })} />
              {copy('Potongan ini tercantum dalam penawaran.', 'This discount is shown in the offer.')}
            </label>
          )}
          {!manual && account.zeroInterestOption && (provider?.id !== 'shopee' || Number(draft.months) >= 3) && (
            <label className="credit-option-check">
              <input type="checkbox" checked={draft.zeroInterest}
                onChange={event => update({ zeroInterest: event.target.checked })} />
              {copy('Pilih cicilan bunga 0%', 'Choose 0% interest')}
            </label>
          )}
          {!manual && account.method === 'custom_flat' && !draft.zeroInterest && (
            <label className="decision-v2-field">
              {copy('Bunga flat per bulan (%)', 'Flat monthly rate (%)')}
              <input inputMode="decimal" value={draft.rate} onChange={event => update({ rate: event.target.value })} />
            </label>
          )}
          {!manual && term?.fee.type === 'conflicting' && (
            <label className="decision-v2-field">
              {copy('Biaya admin sesuai penawaran', 'Administration fee shown in offer')}
              <select value={draft.feeRate} onChange={event => update({ feeRate: event.target.value })}>
                <option value="">{copy('Belum dikonfirmasi (pakai rentang)', 'Unconfirmed (use range)')}</option>
                {term.fee.bps.map(bps => <option key={bps} value={bps}>
                  {new Intl.NumberFormat(locale, { style: 'percent' }).format(bps / 10_000)}
                </option>)}
              </select>
            </label>
          )}
          {!manual && term?.fee.type !== 'conflicting' && (
            currencyField('fee', copy('Total biaya tambahan sesuai penawaran (Rp)', 'Total additional fees in offer (Rp)'))
          )}
        </details>
        )}
        {provider?.reference && (
        <details className="credit-source">
          <summary>{copy('Bunga dan sumber', 'Rates and sources')}</summary>
          <p className="hint">
          {copy(
            `Referensi bunga per ${date(provider.reference.date)}. Bunga dan biaya aktual dapat berbeda sesuai penawaran penyedia.`,
            `Rate reference as of ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(provider.reference.date))}. Actual rates and fees may vary by provider offer.`,
          )}{' '}
          {provider.reference.sources.map((source, index) => (
            <a key={source} href={source} target="_blank" rel="noopener noreferrer">
              {index === 0 ? copy('Lihat sumber', 'View source') : copy(`Sumber ${index + 1}`, `Source ${index + 1}`)}
            </a>
          ))}
          </p>
        </details>
        )}
      </div>}
    </div>
  );
}

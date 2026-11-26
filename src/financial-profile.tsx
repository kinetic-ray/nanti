import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from './api.js';
import { useLocale } from './locale.js';
import type {
  AdditionalSection, DebtItem, DebtSection, ExpenseClassification, ExpenseItem, ExpenseSection,
  FinancialGoal, FinancialProfile, IncomeItem, IncomeSection, ReadinessSection, SavingsSection,
} from '../shared/financial-profile.js';

type Category = 'income' | 'expenses' | 'debts' | 'savings';
type Drafts = { income: IncomeSection; expenses: ExpenseSection; debts: DebtSection; savings: SavingsSection;
  readiness: ReadinessSection; additional: AdditionalSection };
type LoadState = 'loading' | 'ready' | 'failed';

const incomeSuggestions = ['Gaji utama', 'Penghasilan tambahan'];
const expenseSuggestions: { name: string; classification: ExpenseClassification }[] = [
  { name: 'Tempat tinggal', classification: 'essential' },
  { name: 'Makan & minum', classification: 'essential' },
  { name: 'Transportasi', classification: 'essential' },
  { name: 'Tagihan & internet', classification: 'essential' },
  { name: 'Keluarga & tanggungan', classification: 'obligation' },
  { name: 'Kesehatan', classification: 'essential' },
  { name: 'Hiburan & gaya hidup', classification: 'flexible' },
  { name: 'Kebutuhan lainnya', classification: 'unclassified' },
];
const blankIncome = (): IncomeSection => ({ items: incomeSuggestions.map(name => ({ id: crypto.randomUUID(), name, monthlyNet: null })), stability: null, confirmed: false });
const blankExpenses = (): ExpenseSection => ({ items: expenseSuggestions.map(({ name, classification }) => ({
  id: crypto.randomUUID(), name, monthlyAmount: null, classification,
})), confirmed: false });
const blankDebt = (): DebtSection => ({ status: 'unknown', items: [] });
const blankDrafts = (): Drafts => ({ income: blankIncome(), expenses: blankExpenses(), debts: blankDebt(),
  savings: { monthlyAmount: null }, readiness: { availableCash: null, emergencyFund: null }, additional: { payday: null, goals: [] } });

function draftsFrom(profile: FinancialProfile): Drafts {
  const blank = blankDrafts();
  return {
    income: profile.income ?? blank.income,
    expenses: profile.expenses ?? blank.expenses,
    debts: profile.debts ?? blank.debts,
    savings: profile.savings ?? blank.savings,
    readiness: profile.readiness ?? blank.readiness,
    additional: profile.additional ?? blank.additional,
  };
}

function formatDigits(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
}

function formatRupiah(value: string) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(BigInt(value));
}

function AmountInput({ label, value, onChange, compact = false }: {
  label: string; value: string | null; onChange: (value: string | null) => void; compact?: boolean;
}) {
  const { language } = useLocale();
  const [display, setDisplay] = useState(value === null ? '' : formatDigits(value));
  useEffect(() => setDisplay(value === null ? '' : formatDigits(value)), [value]);
  return <label className={`fp-amount${compact ? ' fp-amount-compact' : ''}`}>
    <span>{label}</span>
    <span className="fp-amount-control"><span aria-hidden="true">Rp</span>
      <input type="text" inputMode="numeric" autoComplete="off" spellCheck={false} value={display}
        aria-label={`${label} (${language === 'id' ? 'Rupiah' : 'Indonesian Rupiah'})`}
        placeholder={language === 'id' ? 'Belum diisi' : 'Not filled in'}
        onChange={event => {
          const target = event.currentTarget;
          const digitsBefore = target.value.slice(0, target.selectionStart ?? target.value.length).replace(/\D/gu, '').length;
          const raw = target.value.trim().replace(/^Rp\s*/iu, '');
          if (/[^\d.]/u.test(raw)) return;
          const pasted = (event.nativeEvent as InputEvent).inputType === 'insertFromPaste';
          if (pasted && raw.includes('.') && !/^\d{1,3}(?:\.\d{3})+$/u.test(raw)) return;
          const digits = raw.replace(/\./gu, '');
          if (digits.length > 13 || (digits && Number(digits) > 1_000_000_000_000)) return;
          setDisplay(formatDigits(digits));
          onChange(digits ? String(BigInt(digits)) : null);
          requestAnimationFrame(() => {
            const input = target;
            if (document.activeElement !== input) return;
            const formatted = formatDigits(digits);
            let count = 0;
            let position = 0;
            while (position < formatted.length && count < digitsBefore) {
              if (/\d/u.test(formatted[position] ?? '')) count += 1;
              position += 1;
            }
            input.setSelectionRange(position, position);
          });
        }} />
    </span>
  </label>;
}

function totalAmounts(items: { amount: string | null }[] | null, confirmed: boolean) {
  if (!confirmed || !items || items.some(item => item.amount === null)) return null;
  return items.reduce((sum, item) => sum + BigInt(item.amount ?? '0'), 0n).toString();
}

function today() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function FinancialProfile() {
  const { date, language } = useLocale();
  const l = (id: string, en: string) => language === 'id' ? id : en;
  const [attempt, setAttempt] = useState(0);
  const [profile, setProfile] = useState<FinancialProfile | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(blankDrafts);
  const [load, setLoad] = useState<LoadState>('loading');
  const [expanded, setExpanded] = useState<Category | null>(null);
  const [additionalOpen, setAdditionalOpen] = useState(false);
  const [saving, setSaving] = useState<Category | 'readiness' | 'additional' | 'delete' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [editingReadiness, setEditingReadiness] = useState<'cash' | 'emergency' | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoad('loading');
    setError('');
    api<FinancialProfile>('/account/financial-profile', { signal: controller.signal }).then(saved => {
      if (controller.signal.aborted) return;
      setProfile(saved);
      setDrafts(draftsFrom(saved));
      setLoad('ready');
    }).catch(reason => {
      if (controller.signal.aborted) return;
      const text = errorMessage(reason);
      if (text === 'Sign in to continue.') location.replace('/account?next=financial-profile');
      else setLoad('failed');
    });
    return () => controller.abort();
  }, [attempt]);

  const incomeTotal = totalAmounts(profile?.income?.items.map(item => ({ amount: item.monthlyNet })) ?? null,
    Boolean(profile?.income?.confirmed));
  const expenseTotal = profile?.expenses?.confirmed
    ? profile.expenses.items.reduce((sum, item) => sum + BigInt(item.monthlyAmount ?? '0'), 0n).toString() : null;
  const debtTotal = profile?.debts?.status === 'none' ? '0'
    : profile?.debts?.status === 'listed' && profile.debts.items.every(item => item.monthlyAmount !== null)
      ? profile.debts.items.reduce((sum, item) => sum + BigInt(item.monthlyAmount), 0n).toString() : null;
  const savingsTotal = profile?.savings?.monthlyAmount ?? null;
  const freeBudget = useMemo(() => {
    if ([incomeTotal, expenseTotal, debtTotal, savingsTotal].some(value => value === null)) return null;
    return (BigInt(incomeTotal!) - BigInt(expenseTotal!) - BigInt(debtTotal!) - BigInt(savingsTotal!)).toString();
  }, [incomeTotal, expenseTotal, debtTotal, savingsTotal]);

  async function saveSection<T extends Category | 'readiness' | 'additional'>(section: T, data: Drafts[T]) {
    setSaving(section);
    setError('');
    setNotice('');
    try {
      const updated = await api<FinancialProfile>(`/account/financial-profile/${section}`, { method: 'PUT', data });
      setProfile(updated);
      setDrafts(current => ({ ...current, [section]: data }));
      setNotice(l('Perubahan tersimpan.', 'Changes saved.'));
      if (section === 'readiness') setEditingReadiness(null);
    } catch (failure) {
      if (errorMessage(failure) === 'Sign in to continue.') location.replace('/account?next=financial-profile');
      else setError(l('Perubahan belum tersimpan. Periksa isianmu, lalu coba lagi.', 'Changes were not saved. Check your entries and try again.'));
    } finally { setSaving(null); }
  }

  function setDraft<K extends keyof Drafts>(key: K, value: Drafts[K]) {
    setDrafts(current => ({ ...current, [key]: value }));
  }

  function changeIncomeItem(id: string, patch: Partial<IncomeItem>) {
    setDrafts(current => ({ ...current, income: { ...current.income,
      items: current.income.items.map(item => item.id === id ? { ...item, ...patch } : item) } }));
  }
  function changeExpenseItem(id: string, patch: Partial<ExpenseItem>) {
    setDrafts(current => ({ ...current, expenses: { ...current.expenses,
      items: current.expenses.items.map(item => item.id === id ? { ...item, ...patch } : item) } }));
  }
  function changeDebtItem(id: string, patch: Partial<DebtItem>) {
    setDrafts(current => ({ ...current, debts: { ...current.debts,
      items: current.debts.items.map(item => item.id === id ? { ...item, ...patch,
        ...(patch.remainingMonths !== undefined && patch.remainingMonths !== item.remainingMonths ? { estimateDate: today() } : {}) } : item) } }));
  }

  async function deleteProfile() {
    setSaving('delete');
    setError('');
    try {
      await api('/account/financial-profile', { method: 'DELETE' });
      const empty = { income: null, expenses: null, debts: null, savings: null, readiness: null, additional: null,
        sectionUpdatedAt: {}, createdAt: null, updatedAt: null } satisfies FinancialProfile;
      setProfile(empty);
      setDrafts(draftsFrom(empty));
      setDeleteConfirm(false);
      setNotice(l('Profil finansial sudah dihapus.', 'Your financial profile was deleted.'));
    } catch (failure) {
      if (errorMessage(failure) === 'Sign in to continue.') location.replace('/account?next=financial-profile');
      else setError(l('Profil belum bisa dihapus. Coba lagi.', 'The profile could not be deleted. Try again.'));
    } finally { setSaving(null); }
  }

  const summaryDescription = freeBudget === null
    ? l('Lengkapi keuangan bulananmu untuk melihat perkiraannya.', 'Fill in your monthly finances to see an estimate.')
    : BigInt(freeBudget) < 0n
      ? l('Pengeluaran dan alokasi bulananmu melebihi penghasilan.', 'Your monthly expenses and allocations exceed your income.')
      : l('Setelah kebutuhan, cicilan, dan tabungan.', 'After expenses, installments, and savings.');
  const allocation = freeBudget !== null && incomeTotal !== null && BigInt(incomeTotal) > 0n && BigInt(freeBudget) >= 0n
    ? [expenseTotal!, debtTotal!, savingsTotal!, freeBudget].map(value => Number((BigInt(value) * 10000n) / BigInt(incomeTotal)) / 100) : null;
  const lastUpdated = profile?.updatedAt ? date(profile.updatedAt) : null;

  return <div className="fp-page">
      {load === 'loading' ? <div className="fp-loading" role="status">{l('Memuat profil finansial…', 'Loading your financial profile…')}</div>
        : load === 'failed' ? <section className="fp-feedback"><p role="alert">
          {l('Profil finansial belum bisa dimuat. Coba lagi.', 'Your financial profile could not be loaded. Try again.')}</p>
          <button type="button" onClick={() => setAttempt(value => value + 1)}>{l('Coba lagi', 'Try again')}</button></section>
          : <>
            <section className="fp-summary" aria-labelledby="fp-summary-heading">
              <p id="fp-summary-heading">{l('Uang bebas per bulan', 'Available per month')}</p>
              <strong className={freeBudget !== null && BigInt(freeBudget) < 0n ? 'is-negative' : ''}>
                {freeBudget === null ? l('Belum bisa dihitung', 'Not enough information')
                  : freeBudget.startsWith('-') ? `−${formatRupiah(freeBudget.slice(1))}` : formatRupiah(freeBudget)}
              </strong>
              <span>{summaryDescription}</span>
              {allocation && <div className="fp-allocation" role="img" aria-label={l('Perbandingan kebutuhan, cicilan, tabungan, dan uang bebas.', 'Share of expenses, installments, savings, and available money.')}>
                {allocation.map((width, index) => <span key={index} className={`fp-allocation-part fp-allocation-${index}`} style={{ width: `${width}%` }} />)}
              </div>}
              {allocation && <div className="fp-allocation-legend"><span>{l('Kebutuhan', 'Expenses')}</span><span>{l('Cicilan', 'Installments')}</span>
                <span>{l('Tabungan', 'Savings')}</span><span>{l('Uang bebas', 'Available')}</span></div>}
            </section>

            <section className="fp-section" aria-labelledby="fp-monthly-heading">
              <div className="fp-section-heading"><h3 id="fp-monthly-heading">{l('Keuangan bulanan', 'Monthly finances')}</h3>
                <p>{l('Informasi utama untuk memahami kemampuan belanjamu.', 'The key details for understanding your spending capacity.')}</p>
              </div>
              <div className="fp-accordion">
                {(['income', 'expenses', 'debts', 'savings'] as const).map(key => {
                  const title = key === 'income' ? l('Penghasilan', 'Income') : key === 'expenses' ? l('Kebutuhan', 'Expenses')
                    : key === 'debts' ? l('Cicilan', 'Installments') : l('Target tabungan', 'Savings target');
                  const amount = key === 'income' ? incomeTotal : key === 'expenses' ? expenseTotal
                    : key === 'debts' ? debtTotal : savingsTotal;
                  const unknown = amount === null;
                  const expandedNow = expanded === key;
                  return <article className={`fp-accordion-item${expandedNow ? ' is-open' : ''}`} key={key}>
                    <h4><button type="button" className="fp-accordion-trigger" aria-expanded={expandedNow}
                      aria-controls={`fp-panel-${key}`} onClick={() => { setExpanded(expandedNow ? null : key); setError(''); }}>
                      <span>{title}</span><span className="fp-parent-value">{unknown ? l('Belum diisi', 'Not filled in') : formatRupiah(amount)}</span>
                      <ChevronDown size={18} aria-hidden="true" />
                    </button></h4>
                    {expandedNow && <div id={`fp-panel-${key}`} className="fp-panel">
                      {key === 'income' && <>
                        <p className="fp-helper">{l('Masukkan uang yang biasanya kamu terima setelah potongan.', 'Enter the money you usually receive after deductions.')}</p>
                        <div className="fp-edit-list">{drafts.income.items.map(item => <div className="fp-edit-row" key={item.id}>
                          <label className="fp-text-field"><span>{l('Sumber penghasilan', 'Income source')}</span>
                            <input value={item.name} maxLength={80} onChange={event => changeIncomeItem(item.id, { name: event.target.value })} /></label>
                          <AmountInput label={l('Per bulan', 'Per month')} value={item.monthlyNet} compact
                            onChange={monthlyNet => changeIncomeItem(item.id, { monthlyNet })} />
                          <button className="fp-icon-button" type="button" aria-label={`${l('Hapus', 'Remove')} ${item.name}`} onClick={() => setDraft('income', {
                            ...drafts.income, items: drafts.income.items.filter(row => row.id !== item.id) })}><Trash2 size={16} /></button>
                        </div>)}</div>
                        <button className="fp-text-action" type="button" onClick={() => setDraft('income', { ...drafts.income,
                          items: [...drafts.income.items, { id: crypto.randomUUID(), name: '', monthlyNet: null }] })}>
                          <Plus size={16} aria-hidden="true" />{l('Tambah penghasilan', 'Add income')}</button>
                        <label className="fp-select-field"><span>{l('Penghasilanmu biasanya…', 'Your income is usually…')}</span>
                          <select value={drafts.income.stability ?? ''} onChange={event => setDraft('income', { ...drafts.income,
                            stability: (event.target.value || null) as IncomeSection['stability'] })}>
                            <option value="">{l('Pilih salah satu', 'Choose one')}</option>
                            <option value="steady">{l('Tetap setiap bulan', 'The same each month')}</option>
                            <option value="variable">{l('Berubah-ubah', 'Changes from month to month')}</option>
                            <option value="irregular">{l('Tidak menentu', 'Unpredictable')}</option>
                          </select></label>
                        <label className="fp-check"><input type="checkbox" checked={drafts.income.confirmed} onChange={event => setDraft('income', {
                          ...drafts.income, confirmed: event.target.checked })} />
                          <span>{l('Jumlah ini sudah mencakup seluruh penghasilan bulananmu.', 'This covers all of your monthly income.')}</span></label>
                        <SectionSave busy={saving === key} disabled={drafts.income.items.some(item => !item.name.trim())}
                          onSave={() => void saveSection('income', drafts.income)} />
                      </>}
                      {key === 'expenses' && <>
                        <p className="fp-helper">{l('Masukkan kebutuhan rutinmu, tidak termasuk cicilan dan uang yang ingin ditabung.', 'Enter regular expenses, excluding installments and money you want to save.')}</p>
                        <div className="fp-edit-list">{drafts.expenses.items.map(item => <div className="fp-edit-row fp-expense-row" key={item.id}>
                          <label className="fp-text-field"><span>{l('Nama kebutuhan', 'Expense name')}</span>
                            <input value={item.name} maxLength={80} onChange={event => changeExpenseItem(item.id, { name: event.target.value })} /></label>
                          <AmountInput label={l('Per bulan', 'Per month')} value={item.monthlyAmount} compact
                            onChange={monthlyAmount => changeExpenseItem(item.id, { monthlyAmount })} />
                          <label className="fp-classification"><span className="sr-only">{l('Jenis kebutuhan', 'Expense type')}</span>
                            <select aria-label={`${l('Jenis kebutuhan', 'Expense type')}: ${item.name}`} value={item.classification}
                              onChange={event => changeExpenseItem(item.id, { classification: event.target.value as ExpenseClassification })}>
                              <option value="essential">{l('Kebutuhan utama', 'Essential')}</option>
                              <option value="obligation">{l('Tanggungan', 'Obligation')}</option>
                              <option value="flexible">{l('Fleksibel', 'Flexible')}</option>
                              <option value="unclassified">{l('Belum yakin', 'Not sure')}</option>
                            </select></label>
                          <button className="fp-icon-button" type="button" aria-label={`${l('Hapus', 'Remove')} ${item.name}`} onClick={() => setDraft('expenses', {
                            ...drafts.expenses, items: drafts.expenses.items.filter(row => row.id !== item.id) })}><Trash2 size={16} /></button>
                        </div>)}</div>
                        <button className="fp-text-action" type="button" onClick={() => setDraft('expenses', { ...drafts.expenses,
                          items: [...drafts.expenses.items, { id: crypto.randomUUID(), name: '', monthlyAmount: null, classification: 'unclassified' }] })}>
                          <Plus size={16} aria-hidden="true" />{l('Tambah kebutuhan', 'Add expense')}</button>
                        <label className="fp-check"><input type="checkbox" checked={drafts.expenses.confirmed} onChange={event => setDraft('expenses', {
                          ...drafts.expenses, confirmed: event.target.checked })} />
                          <span>{l('Aku sudah mencatat semua kebutuhan rutinku. Bagian yang kosong tidak perlu dihitung.', 'I have listed all my regular expenses. Empty rows can be counted as none.')}</span></label>
                        <SectionSave busy={saving === key} disabled={drafts.expenses.items.some(item => !item.name.trim())}
                          onSave={() => void saveSection('expenses', drafts.expenses)} />
                      </>}
                      {key === 'debts' && <>
                        <p className="fp-helper">{l('Masukkan cicilan, utang, atau PayLater yang kamu bayar setiap bulan.', 'Add installments, debt, or PayLater payments you make each month.')}</p>
                        {drafts.debts.items.length === 0 && <p className="fp-muted">{drafts.debts.status === 'none'
                          ? l('Tidak ada cicilan', 'No installments') : l('Belum ada cicilan yang dicatat.', 'No installments have been added.')}</p>}
                        <div className="fp-edit-list">{drafts.debts.items.map(item => <div className="fp-edit-row fp-debt-row" key={item.id}>
                          <label className="fp-text-field"><span>{l('Nama cicilan', 'Installment name')}</span>
                            <input value={item.name} maxLength={80} onChange={event => changeDebtItem(item.id, { name: event.target.value })} /></label>
                          <AmountInput label={l('Cicilan per bulan', 'Monthly payment')} value={item.monthlyAmount} compact
                            onChange={monthlyAmount => changeDebtItem(item.id, { monthlyAmount: monthlyAmount ?? '' })} />
                          <label className="fp-text-field fp-months"><span>{l('Sisa bulan (opsional)', 'Months left (optional)')}</span>
                            <input type="number" min="1" max="600" inputMode="numeric" value={item.remainingMonths ?? ''}
                              onChange={event => changeDebtItem(item.id, { remainingMonths: event.target.value ? Number(event.target.value) : null })} /></label>
                          <button className="fp-icon-button" type="button" aria-label={`${l('Hapus', 'Remove')} ${item.name}`} onClick={() => {
                            const items = drafts.debts.items.filter(row => row.id !== item.id);
                            setDraft('debts', { items, status: items.length ? 'listed' : 'none' });
                          }}><Trash2 size={16} /></button>
                          {item.estimateDate && item.remainingMonths !== null && <small className="fp-estimate-date">
                            {l('Perkiraan sisa bulan dicatat', 'Remaining term estimate dated')} {date(item.estimateDate)}</small>}
                        </div>)}</div>
                        {drafts.debts.items.some(item => item.estimateDate && item.remainingMonths !== null &&
                          Date.now() - new Date(item.estimateDate).getTime() > 31 * 86_400_000) &&
                          <p className="fp-muted">{l('Perkiraan sisa cicilan mungkin perlu diperbarui.', 'The remaining-term estimate may need an update.')}</p>}
                        <div className="fp-inline-actions">
                          <button className="fp-text-action" type="button" onClick={() => setDraft('debts', { status: 'listed', items: [
                            ...drafts.debts.items, { id: crypto.randomUUID(), name: '', monthlyAmount: '', remainingMonths: null, estimateDate: null }] })}>
                            <Plus size={16} aria-hidden="true" />{l('Tambah cicilan', 'Add installment')}</button>
                          <button className="fp-text-action fp-no-debt" type="button" onClick={() => setDraft('debts', { status: 'none', items: [] })}>
                            {l('Tidak ada cicilan', 'No installments')}</button>
                        </div>
                        <SectionSave busy={saving === key} disabled={drafts.debts.status === 'listed' && drafts.debts.items.some(item => !item.name.trim() || !item.monthlyAmount)}
                          onSave={() => void saveSection('debts', drafts.debts)} />
                      </>}
                      {key === 'savings' && <>
                        <AmountInput label={l('Uang yang ingin ditabung setiap bulan', 'Money you want to save each month')}
                          value={drafts.savings.monthlyAmount} onChange={monthlyAmount => setDraft('savings', { monthlyAmount })} />
                        <p className="fp-helper">{l('Uang yang ingin kamu sisihkan untuk masa depan.', 'Money you want to set aside for the future.')}</p>
                        <SectionSave busy={saving === key}
                          onSave={() => void saveSection('savings', drafts.savings)} />
                      </>}
                    </div>}
                  </article>;
                })}
              </div>
            </section>

            <section className="fp-section fp-readiness" aria-labelledby="fp-readiness-heading">
              <div className="fp-section-heading"><h3 id="fp-readiness-heading">{l('Kesiapan membeli', 'Purchase readiness')}</h3>
                <p>{l('Disarankan untuk rekomendasi yang lebih akurat.', 'Recommended for more accurate suggestions.')}</p>
              </div>
              <div className="fp-compact-rows">
                <ReadinessRow title={l('Uang yang bisa dipakai sekarang', 'Cash available now')}
                  helper={l('Uang yang tidak dialokasikan untuk kebutuhan atau tujuan lain.', 'Money not set aside for expenses or other goals.')}
                  value={drafts.readiness.availableCash} format={formatRupiah}
                  editing={editingReadiness === 'cash'} onEdit={() => setEditingReadiness(editingReadiness === 'cash' ? null : 'cash')}
                  onChange={availableCash => setDraft('readiness', { ...drafts.readiness, availableCash })}
                  onSave={() => void saveSection('readiness', drafts.readiness)} busy={saving === 'readiness'}
                  canSave={drafts.readiness.availableCash !== null || Boolean(profile?.readiness)} />
                <ReadinessRow title={l('Dana darurat', 'Emergency fund')}
                  helper={l('Uang cadangan untuk kejadian tak terduga.', 'Money reserved for unexpected events.')}
                  value={drafts.readiness.emergencyFund} format={formatRupiah}
                  editing={editingReadiness === 'emergency'} onEdit={() => setEditingReadiness(editingReadiness === 'emergency' ? null : 'emergency')}
                  onChange={emergencyFund => setDraft('readiness', { ...drafts.readiness, emergencyFund })}
                  onSave={() => void saveSection('readiness', drafts.readiness)} busy={saving === 'readiness'}
                  canSave={drafts.readiness.emergencyFund !== null || Boolean(profile?.readiness)} />
              </div>
            </section>

            <section className="fp-additional" aria-labelledby="fp-additional-heading">
              <h3><button type="button" aria-expanded={additionalOpen} aria-controls="fp-additional-panel"
                onClick={() => setAdditionalOpen(value => !value)}><span><strong id="fp-additional-heading">{l('Informasi tambahan', 'Additional information')}</strong>
                  <small>{l('Opsional', 'Optional')}</small></span><ChevronDown size={18} aria-hidden="true" /></button></h3>
              {additionalOpen && <div id="fp-additional-panel" className="fp-additional-panel">
                <label className="fp-select-field"><span>{l('Tanggal gajian', 'Payday')}</span>
                  <select value={drafts.additional.payday ?? ''} onChange={event => setDraft('additional', { ...drafts.additional,
                    payday: event.target.value ? Number(event.target.value) : null })}>
                    <option value="">{l('Belum diisi', 'Not filled in')}</option>
                    {Array.from({ length: 31 }, (_, index) => index + 1).map(day => <option value={day} key={day}>{l(`Tanggal ${day}`, `Day ${day}`)}</option>)}
                  </select></label>
                <div className="fp-goals-heading"><h4>{l('Tujuan finansial', 'Financial goals')}</h4>
                  <button className="fp-text-action" type="button" onClick={() => setDraft('additional', { ...drafts.additional,
                    goals: [...drafts.additional.goals, { id: crypto.randomUUID(), name: '', targetAmount: '', savedAmount: '', targetDate: null }] })}>
                    <Plus size={16} aria-hidden="true" />{l('Tambah tujuan', 'Add a goal')}</button></div>
                {drafts.additional.goals.length === 0 && <p className="fp-muted">{l('Contoh: dana pendidikan, laptop baru, atau dana darurat.', 'Examples: education, a new laptop, or an emergency fund.')}</p>}
                <div className="fp-goals">{drafts.additional.goals.map(goal => <GoalEditor key={goal.id} goal={goal} onChange={patch => setDraft('additional', {
                  ...drafts.additional, goals: drafts.additional.goals.map(item => item.id === goal.id ? { ...item, ...patch } : item) })}
                  onRemove={() => setDraft('additional', { ...drafts.additional, goals: drafts.additional.goals.filter(item => item.id !== goal.id) })} />)}</div>
                <SectionSave busy={saving === 'additional'} disabled={drafts.additional.goals.some(goal =>
                  !goal.name.trim() || !goal.targetAmount || !goal.savedAmount)} onSave={() => void saveSection('additional', drafts.additional)} />
              </div>}
            </section>

            <section className="fp-privacy" aria-label={l('Privasi', 'Privacy')}>
              <p>{l('Informasi ini hanya bisa diakses saat kamu masuk ke akunmu. Data disimpan sampai kamu menghapusnya atau akunmu ditutup.',
                'Only you can access this information while signed in. It is kept until you delete it or close your account.')}</p>
              {lastUpdated && <small>{l('Terakhir diperbarui', 'Last updated')} {lastUpdated}</small>}
              {profile?.createdAt && <button type="button" className="fp-delete-link" onClick={() => setDeleteConfirm(value => !value)}>
                {l('Hapus profil finansial', 'Delete financial profile')}</button>}
              {deleteConfirm && <div className="fp-delete-confirm" role="group" aria-label={l('Konfirmasi hapus profil', 'Confirm profile deletion')}>
                <p>{l('Semua informasi finansial yang tersimpan akan dihapus.', 'All saved financial information will be deleted.')}</p>
                <button type="button" className="fp-danger-button" disabled={saving === 'delete'} onClick={() => void deleteProfile()}>
                  {saving === 'delete' ? l('Menghapus…', 'Deleting…') : l('Ya, hapus profil', 'Delete profile')}</button>
                <button type="button" className="fp-quiet-button" onClick={() => setDeleteConfirm(false)}>{l('Batal', 'Cancel')}</button>
              </div>}
            </section>
          </>}
      <div className="fp-live" role="status" aria-live="polite">{notice}</div>
      {load === 'ready' && error && <p className="fp-error" role="alert">{error}</p>}
  </div>;
}

function SectionSave({ busy, disabled = false, onSave }: { busy: boolean; disabled?: boolean; onSave: () => void }) {
  const { language } = useLocale();
  return <div className="fp-save-row"><button type="button" className="primary" disabled={busy || disabled} onClick={onSave}>
    {busy ? (language === 'id' ? 'Menyimpan…' : 'Saving…') : (language === 'id' ? 'Simpan' : 'Save')}
  </button></div>;
}

function ReadinessRow({ title, helper, value, format, editing, onEdit, onChange, onSave, busy, canSave }: {
  title: string; helper: string; value: string | null; format: (value: string) => string; editing: boolean;
  onEdit: () => void; onChange: (value: string | null) => void; onSave: () => void; busy: boolean; canSave: boolean;
}) {
  const { language } = useLocale();
  return <article className="fp-readiness-row">
    <button type="button" className="fp-readiness-trigger" aria-expanded={editing} onClick={onEdit}>
      <span><strong>{title}</strong><small>{helper}</small></span>
      <span className="fp-readiness-value">{value === null ? (language === 'id' ? 'Belum diisi' : 'Not filled in') : format(value)}</span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    {editing && <div className="fp-readiness-editor"><AmountInput label={title} value={value} onChange={onChange} compact />
      <SectionSave busy={busy} disabled={!canSave} onSave={onSave} /></div>}
  </article>;
}

function GoalEditor({ goal, onChange, onRemove }: { goal: FinancialGoal; onChange: (patch: Partial<FinancialGoal>) => void; onRemove: () => void }) {
  const { language } = useLocale();
  const l = (id: string, en: string) => language === 'id' ? id : en;
  return <article className="fp-goal">
    <div className="fp-goal-top"><label className="fp-text-field"><span>{l('Nama tujuan', 'Goal name')}</span>
      <input value={goal.name} maxLength={80} placeholder={l('Contoh: Laptop baru', 'For example, a new laptop')}
        onChange={event => onChange({ name: event.target.value })} /></label>
      <button className="fp-icon-button" type="button" aria-label={l('Hapus tujuan', 'Remove goal')} onClick={onRemove}><Trash2 size={16} /></button></div>
    <div className="fp-goal-fields"><AmountInput label={l('Target nominal', 'Target amount')} value={goal.targetAmount || null}
      onChange={targetAmount => onChange({ targetAmount: targetAmount ?? '' })} compact />
      <AmountInput label={l('Uang terkumpul', 'Saved so far')} value={goal.savedAmount || null}
        onChange={savedAmount => onChange({ savedAmount: savedAmount ?? '' })} compact />
      <label className="fp-text-field"><span>{l('Target tanggal (opsional)', 'Target date (optional)')}</span>
        <input type="date" value={goal.targetDate ?? ''} onChange={event => onChange({ targetDate: event.target.value || null })} /></label>
    </div>
    <span className="sr-only">{goal.targetAmount ? formatRupiah(goal.targetAmount) : ''}</span>
  </article>;
}

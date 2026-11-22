import { useEffect, useRef, useState } from 'react';
import { assessPurchase } from '../shared/purchase-decision.js';
import { screeningQuestions } from '../shared/screening.js';
import type { ScreeningAnswers } from '../shared/screening.js';
import type { Item, Wishlist } from '../shared/wishlist.js';
import { useLocale } from './locale.js';
import { api } from './api.js';
import { AlternativeRecommendations } from './AlternativeRecommendations.js';
import type { RecommendationMatch } from '../server/recommendation-matching.js';

const prompts = {
  practicalNeed: ['Apakah barang ini benar-benar kamu butuhkan?', 'Do you actually need this item?'],
  alreadyHave: ['Apakah kamu sudah punya barang yang fungsinya sama?', 'Do you already own something similar?'],
  useOften: ['Apakah barang ini akan sering kamu gunakan?', 'Will you use it often?'],
  canWait: ['Apakah pembelian ini bisa ditunda tanpa masalah?', 'Can this purchase wait without consequences?'],
  withoutDiscount: ['Kalau tidak sedang diskon, apakah kamu masih menginginkannya?', 'Would you still want it without a discount?'],
  socialPressure: ['Apakah kamu ingin membeli karena tren atau takut ketinggalan?', 'Are trends or fear of missing out driving this purchase?'],
} as const;
const labels = {
  uncertain: ['Perlu informasi lebih lengkap', 'More information needed'],
  pause: ['Tunda dulu pembeliannya', 'Pause this purchase'],
  save: ['Butuh dana tambahan, tunda dulu', 'Save more before buying'],
  alternative: ['Pertimbangkan alternatif lebih hemat', 'Consider a less expensive option'],
  reflect: ['Pikirkan lagi sebelum membeli', 'Reflect before buying'],
  consider: ['Layak dipertimbangkan untuk dibeli', 'Worth considering'],
} as const;
const actions = {
  uncertain: ['Lengkapi jawabanmu sebelum mengambil keputusan.', 'Complete your answers before deciding.'],
  pause: ['Simpan di wishlist dan evaluasi lagi setelah beberapa hari. Uang cukup bukan alasan untuk membeli barang yang belum diperlukan.', 'Keep it on your wishlist and revisit it after a few days. Affordability alone is not a reason to buy.'],
  save: ['Jangan gunakan uang untuk tagihan atau uang yang ingin disisihkan. Menabung dulu atau cari pilihan yang lebih murah.', 'Protect bill money and savings. Save first or find a cheaper option.'],
  alternative: ['Harga barang ini memakai lebih dari separuh uang yang aman untuk belanja. Bandingkan pilihan yang lebih murah.', 'This would use over half of your spendable money. Compare less expensive options.'],
  reflect: ['Kondisi uang memungkinkan, tetapi alasan membeli belum cukup kuat. Bandingkan manfaat dan alternatif.', 'Your finances may allow it, but your reasons are not yet strong. Compare benefits and alternatives.'],
  consider: ['Kebutuhan cukup jelas dan uang belanja masih mencukupi. Tetap bandingkan harga dan kualitas sebelum membeli.', 'The need is clear and spendable funds cover the price. Compare price and quality first.'],
} as const;
export function formatMoneyInput(raw: string, language: 'id' | 'en'): string {
  const separator = language === 'id' ? '.' : ',';
  // Keep entry simple: digits are whole currency units, grouped as they are typed.
  // Paste from another locale is supported by stripping grouping marks.
  const digits = raw.replace(/[^\d]/g, '').slice(0, 15);
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}
export function toMinor(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (!/^\d{1,15}$|^\d{1,3}(?:[.,]\d{3}){1,4}$/.test(trimmed)) return null;
  const digits = trimmed.replace(/[.,]/g, '');
  return BigInt(digits) * 100n;
}
export function GuidedPurchaseDecision({ list, item, close }: { list: Wishlist; item: Item; close: () => void }) {
  const { language, money } = useLocale();
  const lang = language === 'id' ? 0 : 1;
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [question, setQuestion] = useState(0);
  const [answers, setAnswers] = useState<ScreeningAnswers>({});
  const [cash, setCash] = useState('');
  const [bills, setBills] = useState('');
  const [aside, setAside] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const fixedPrice = item.priceMinor === null ? null : BigInt(item.priceMinor) * BigInt(item.quantity);
  const priceValue = fixedPrice ?? toMinor(price);
  const finance = priceValue !== null && toMinor(cash) !== null && toMinor(bills) !== null && toMinor(aside) !== null
    ? { priceMinor: priceValue, cashMinor: toMinor(cash)!, billsMinor: toMinor(bills)!, setAsideMinor: toMinor(aside)! } : null;
  const assessment = finance ? assessPurchase(answers, finance) : null;
  useEffect(() => { heading.current?.focus(); }, [stage, question]);
  function next() {
    setError('');
    if (!finance || finance.priceMinor <= 0n) {
      setError(lang === 0 ? 'Isi semua jumlah dengan angka yang valid. Isi 0 jika tidak ada.' : 'Enter valid amounts in every field. Use 0 when none.');
      return;
    }
    setStage(3);
  }
  function answer(value: boolean | undefined) {
    const key = screeningQuestions[question];
    if (!key) return;
    setAnswers(current => ({ ...current, [key]: value }));
    if (question === screeningQuestions.length - 1) setStage(2);
    else setQuestion(current => current + 1);
  }
  const currency = (value: bigint) => money(value.toString(), list.currency);
  return <div className="guided-decision">
    <p className="hint">{item.name}</p>
    <div className="guided-progress" aria-label={lang === 0 ? 'Progres penilaian' : 'Assessment progress'}>
      <span className={stage >= 1 ? 'active' : ''}>1. {lang === 0 ? 'Alasan beli' : 'Buying reasons'}</span>
      <span className={stage >= 2 ? 'active' : ''}>2. {lang === 0 ? 'Kesiapan uang' : 'Money readiness'}</span>
    </div>
    {stage === 1 && <section className="decision-section">
      <p className="hint">{lang === 0 ? `Pertanyaan ${question + 1} dari ${screeningQuestions.length}` : `Question ${question + 1} of ${screeningQuestions.length}`}</p>
      <h3 tabIndex={-1} ref={heading}>{prompts[screeningQuestions[question] ?? screeningQuestions[0]!][lang]}</h3>
      <div className="answer-buttons screening-answers">
        <button type="button" onClick={() => answer(true)}>{lang === 0 ? 'Ya' : 'Yes'}</button>
        <button type="button" onClick={() => answer(false)}>{lang === 0 ? 'Tidak' : 'No'}</button>
        <button type="button" onClick={() => answer(undefined)}>{lang === 0 ? 'Belum yakin' : 'Not sure'}</button>
      </div>
      {question > 0 && <button type="button" className="text-button" onClick={() => setQuestion(current => current - 1)}>{lang === 0 ? 'Kembali' : 'Back'}</button>}
    </section>}
    {stage === 2 && <section className="decision-section">
      <h3 tabIndex={-1} ref={heading}>{lang === 0 ? 'Seberapa siap uangmu?' : 'How ready is your budget?'}</h3>
      <p className="hint">{lang === 0 ? 'Kami hitung uang yang bisa dipakai tanpa mengganggu pengeluaran penting dan uang yang kamu sisihkan.' : 'We check what you can spend without touching important expenses or money set aside.'}</p>
      <p><strong>{lang === 0 ? 'Harga barang' : 'Item price'}: </strong>{fixedPrice === null ? (lang === 0 ? 'Belum ada harga' : 'Price unknown') : currency(fixedPrice)}</p>
      <form noValidate autoComplete="off" onSubmit={event => { event.preventDefault(); next(); }}>
        <div className="guided-fields">
          {fixedPrice === null && <label>{lang === 0 ? 'Perkiraan harga barang' : 'Estimated item price'}<input inputMode="numeric" value={price} onChange={event => setPrice(formatMoneyInput(event.target.value, language))} placeholder="0" required /></label>}
          <label>{lang === 0 ? 'Uang yang kamu punya' : 'Money you have'}<input inputMode="numeric" value={cash} onChange={event => setCash(formatMoneyInput(event.target.value, language))} placeholder="0" required /></label>
          <label>{lang === 0 ? 'Pengeluaran yang harus dibayar' : 'Expenses you still need to pay'}<input inputMode="numeric" value={bills} onChange={event => setBills(formatMoneyInput(event.target.value, language))} placeholder="0" required /><small className="hint">{lang === 0 ? 'Misalnya makan, kos, cicilan, dan tagihan yang belum dibayar.' : 'For example food, rent, installments and unpaid bills.'}</small></label>
          <label>{lang === 0 ? 'Uang yang ingin kamu sisihkan' : 'Money you want to set aside'}<input inputMode="numeric" value={aside} onChange={event => setAside(formatMoneyInput(event.target.value, language))} placeholder="0" required /><small className="hint">{lang === 0 ? 'Misalnya tabungan atau dana darurat yang tidak ingin dipakai.' : 'For example savings or emergency money you want to protect.'}</small></label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions"><button type="button" onClick={() => { setStage(1); setQuestion(screeningQuestions.length - 1); }}>{lang === 0 ? 'Kembali' : 'Back'}</button><button className="primary" type="submit">{lang === 0 ? 'Lihat hasil' : 'See result'}</button></div>
      </form>
    </section>}
    {stage === 3 && assessment && finance && <section className="decision-result guided-result">
      <h3 tabIndex={-1} ref={heading}>{labels[assessment.decision][lang]}</h3>
      <p>{actions[assessment.decision][lang]}</p>
      <div className="guided-result-grid">
        <div><small>{lang === 0 ? 'Alasan pembelian' : 'Buying reasons'}</small><strong>{assessment.screening.outcome === 'red' ? (lang === 0 ? 'Ada tanda impulsif / FOMO' : 'Impulse / FOMO signals') : assessment.screening.outcome === 'green' ? (lang === 0 ? 'Kebutuhan cukup jelas' : 'Need is fairly clear') : (lang === 0 ? 'Perlu dipikirkan lagi' : 'Needs more thought')}</strong></div>
        <div><small>{lang === 0 ? 'Uang aman untuk belanja' : 'Protected spending capacity'}</small><strong>{currency(assessment.safeToSpend)}</strong></div>
        <div><small>{lang === 0 ? 'Porsi harga dari uang belanja' : 'Share of spendable funds'}</small><strong>{assessment.share === null ? '—' : `${assessment.share}%`}</strong></div>
        <div><small>{lang === 0 ? 'Kekurangan dana' : 'Funding gap'}</small><strong>{currency(assessment.gap)}</strong></div>
      </div>
      <h4>{lang === 0 ? 'Kenapa hasilnya begitu?' : 'Why this recommendation?'}</h4>
      <ul className="decision-reasons">
        <li>{assessment.screening.outcome === 'red' ? (lang === 0 ? 'Jawabanmu menunjukkan alasan membeli belum kuat atau ada pengaruh tren dan dorongan sesaat.' : 'Your answers suggest a weak need or outside pressure.') : assessment.screening.outcome === 'green' ? (lang === 0 ? 'Jawabanmu menunjukkan manfaat atau kebutuhan yang cukup jelas.' : 'Your answers indicate a clear practical benefit.') : (lang === 0 ? 'Beberapa alasan membeli masih perlu dipastikan.' : 'Some buying reasons remain unclear.')}</li>
        <li>{assessment.gap > 0n ? (lang === 0 ? `Uang aman untuk belanja kurang ${currency(assessment.gap)} dari harga barang.` : `Your protected budget is short by ${currency(assessment.gap)}.`) : assessment.share !== null && assessment.share > 50 ? (lang === 0 ? 'Barang ini menghabiskan lebih dari separuh uang aman untuk belanja.' : 'This item uses over half your spendable funds.') : (lang === 0 ? 'Harga barang tercakup oleh uang yang tersisa setelah pengeluaran dan uang sisihan.' : 'The item fits after expenses and protected savings.')}</li>
      </ul>
      {(assessment.decision === 'alternative' || assessment.decision === 'save') &&
        assessment.screening.outcome === 'green' && (
          <AlternativeRecommendations
            eligible
            currency={list.currency}
            canNotify={false}
            load={async () => {
              const result = await api<{ alternatives: RecommendationMatch[] }>(
                `/recommendations/alternatives?wishlistId=${encodeURIComponent(list.id)}&itemId=${encodeURIComponent(item.id)}`);
              return result.alternatives;
            }}
            requestRecommendation={async () => {
              await api('/recommendations/requests', {
                method: 'POST', data: { wishlistId: list.id, itemId: item.id },
              });
            }}
            onOpenProduct={(url) => { window.open(url, '_blank', 'noopener,noreferrer'); }}
          />
        )}
      <p className="hint">{lang === 0 ? 'Ini perkiraan berdasarkan jawaban dan angka yang kamu isi, bukan jaminan kondisi keuangan sehat. Uang yang kamu masukkan tidak disimpan oleh fitur ini.' : 'This is an estimate based on your answers, not a guarantee of financial health. The amounts entered here are not saved.'}</p>
      <div className="actions"><button type="button" onClick={() => setStage(2)}>{lang === 0 ? 'Ubah isian' : 'Edit budget'}</button><button type="button" className="primary" onClick={close}>{lang === 0 ? 'Selesai' : 'Done'}</button></div>
    </section>}
  </div>;
}

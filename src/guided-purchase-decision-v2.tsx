import './decision-v2.css';
import { useEffect, useRef, useState } from 'react';
import type { Item, Wishlist } from '../shared/wishlist.js';
import {
  motivationOptions,
  priceMinorToRupiah,
  type MotivationId,
  type FinancialProfileSource,
  type PurchaseTerms,
} from '../shared/decision-engine/index.js';
import { useDecisionEngine } from './use-decision-engine.js';
import { useLocale } from './locale.js';
import { api } from './api.js';

const scoreLabels = {
  need: 'Kebutuhan',
  personal_value: 'Nilai pribadi',
  urgency: 'Urgensi',
  impulse: 'Risiko impulsif',
  product_fit: 'Kesesuaian produk',
  evidence: 'Kelengkapan informasi',
} as const;

export function GuidedPurchaseDecisionV2({
  list,
  item,
  close,
}: {
  list: Wishlist;
  item: Item;
  close: () => void;
}) {
  const { money } = useLocale();

  const [profile, setProfile] =
    useState<FinancialProfileSource | null>(null);

  const [loading, setLoading] = useState(true);
  const [primary, setPrimary] = useState<MotivationId | ''>('');
  const [secondary, setSecondary] = useState<MotivationId | ''>('');
  const [method, setMethod] =
    useState<'cash' | 'installment' | 'unknown'>('unknown');

  const [estimate, setEstimate] = useState('');
  const [downPayment, setDownPayment] = useState('');
  const [monthlyPayment, setMonthlyPayment] = useState('');
  const [months, setMonths] = useState('');
  const [refresh, setRefresh] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  const isIDR = list.currency === 'IDR';

  const fixedPrice = isIDR
    ? priceMinorToRupiah(item.priceMinor, item.quantity)
    : null;

  function amount(value: string): number | null {
    if (!/^\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  }

  const price = fixedPrice ?? amount(estimate);

  const purchase: PurchaseTerms =
    !isIDR || price === null || method === 'unknown'
      ? { method: 'unknown', price }
      : method === 'cash'
        ? { method: 'cash', price }
        : {
            method: 'installment',
            price,
            downPayment: amount(downPayment),
            monthlyPayment: amount(monthlyPayment),
            months: amount(months),
          };

  const engine = useDecisionEngine({
    profile: isIDR ? profile : null,
    purchase,
  });

  const { next, assessment, explanation } = engine;

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);

    void api<FinancialProfileSource>(
      '/account/financial-profile',
      { signal: controller.signal },
    )
      .then(value => {
        if (!controller.signal.aborted) setProfile(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setProfile(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    heading.current?.focus();
  }, [engine.answeredCount, next.status]);

  function restart() {
    engine.restart();
    setPrimary('');
    setSecondary('');
    setMethod('unknown');
  }

  return (
    <div className="guided-decision decision-v2">
      <div className="decision-v2-product">
        <strong>{item.name}</strong>
        <span className="hint">
          {item.priceMinor === null
            ? 'Harga belum tersedia'
            : money(
                (
                  BigInt(item.priceMinor) *
                  BigInt(item.quantity)
                ).toString(),
                list.currency,
              )}
        </span>
      </div>

      {!engine.isComplete && (
        <div
          className="decision-v2-progress"
          aria-label="Progres pertimbangan"
        >
          <div
            style={{
              width: `${Math.min(
                100,
                (engine.answeredCount / 8) * 100,
              )}%`,
            }}
          />
        </div>
      )}

      {next.status === 'motivation_required' && (
        <section className="decision-section">
          <p className="hint">Mulai dari alasanmu</p>

          <h3 ref={heading} tabIndex={-1}>
            Apa alasan utama kamu ingin membeli barang ini?
          </h3>

          <div className="decision-v2-options">
            {motivationOptions.map(option => (
              <button
                type="button"
                key={option.id}
                aria-pressed={primary === option.id}
                className="decision-v2-option"
                onClick={() => {
                  setPrimary(option.id);
                  setSecondary('');
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          {primary && (
            <label className="decision-v2-field">
              Alasan pendukung (opsional)
              <select
                value={secondary}
                onChange={event =>
                  setSecondary(
                    event.target.value as MotivationId | '',
                  )
                }
              >
                <option value="">Tidak ada</option>
                {motivationOptions
                  .filter(option =>
                    option.id !== primary &&
                    option.id !== 'unclear',
                  )
                  .map(option => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
              </select>
            </label>
          )}

          <button
            type="button"
            className="decision-v2-primary"
            disabled={!primary}
            onClick={() => {
              if (!primary) return;
              engine.selectMotivation(
                secondary
                  ? { primary, secondary }
                  : { primary },
              );
            }}
          >
            Lanjut
          </button>
        </section>
      )}

      {next.status === 'question' && (
        <section className="decision-section">
          <p className="hint">
            Pertanyaan {engine.answeredCount + 1}
          </p>

          <h3 ref={heading} tabIndex={-1}>
            {next.question.prompt}
          </h3>

          <div className="decision-v2-options">
            {next.question.options.map(option => (
              <button
                type="button"
                className="decision-v2-option"
                key={option.id}
                onClick={() =>
                  engine.answer(next.question.id, option.id)
                }
              >
                {option.label}
              </button>
            ))}
          </div>

          <button type="button" onClick={engine.back}>
            Kembali
          </button>
        </section>
      )}

      {assessment && explanation && (
        <section className="decision-section">
          <p className="hint">Hasil pertimbangan</p>

          <h3 ref={heading} tabIndex={-1}>
            {explanation.title}
          </h3>

          <div className="decision-result">
            <strong>Alasan pembelian</strong>
            <ul className="decision-reasons">
              {explanation.reasons.map(reason => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>

          {loading ? (
            <p role="status" className="hint">
              Memeriksa profil finansialmu...
            </p>
          ) : engine.hasFinancialProfile ? (
            <div className="decision-section">
              <strong>Kesiapan finansial</strong>

              {fixedPrice === null && (
                <label className="decision-v2-field">
                  Perkiraan harga (Rp)
                  <input
                    inputMode="numeric"
                    value={estimate}
                    onChange={event =>
                      setEstimate(
                        event.target.value.replace(/\D/g, ''),
                      )
                    }
                  />
                </label>
              )}

              <label className="decision-v2-field">
                Rencana pembayaran
                <select
                  value={method}
                  onChange={event =>
                    setMethod(
                      event.target.value as typeof method,
                    )
                  }
                >
                  <option value="unknown">
                    Belum menentukan
                  </option>
                  <option value="cash">Tunai</option>
                  <option value="installment">Cicilan</option>
                </select>
              </label>

              {method === 'installment' && (
                <>
                  {[
                    {
                      label: 'Uang muka (Rp)',
                      value: downPayment,
                      change: setDownPayment,
                    },
                    {
                      label: 'Cicilan per bulan (Rp)',
                      value: monthlyPayment,
                      change: setMonthlyPayment,
                    },
                    {
                      label: 'Tenor (bulan)',
                      value: months,
                      change: setMonths,
                    },
                  ].map(field => (
                    <label
                      className="decision-v2-field"
                      key={field.label}
                    >
                      {field.label}
                      <input
                        inputMode="numeric"
                        value={field.value}
                        onChange={event =>
                          field.change(
                            event.target.value.replace(/\D/g, ''),
                          )
                        }
                      />
                    </label>
                  ))}
                </>
              )}

              <ul className="decision-reasons">
                {explanation.financialReasons.map(reason => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {!loading && explanation.financialNotice && (
            <div className="decision-result">
              <p>{explanation.financialNotice}</p>
              {isIDR && (
                <>
                  <a
                    href="/account?section=financial-profile"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Lengkapi profil finansial
                  </a>
                  <button
                    type="button"
                    onClick={() => setRefresh(value => value + 1)}
                  >
                    Perbarui data
                  </button>
                </>
              )}
            </div>
          )}

          <div className="decision-result">
            <strong>Saran untuk kamu</strong>
            <p>{explanation.action}</p>
          </div>

          <details className="decision-section">
            <summary>Rincian penilaian</summary>

            {Object.entries(assessment.behavioral.scores)
              .map(([key, score]) => (
                <div className="decision-v2-score" key={key}>
                  <span>
                    {scoreLabels[key as keyof typeof scoreLabels]}
                  </span>
                  <strong>
                    {score === null
                      ? 'Belum dinilai'
                      : `${score.toFixed(1)} / 5`}
                  </strong>
                  {score !== null && (
                    <progress value={score} max={5} />
                  )}
                </div>
              ))}
          </details>

          <button
            type="button"
            className="decision-v2-primary"
            onClick={close}
          >
            Selesai
          </button>

          <button type="button" onClick={restart}>
            Ulangi pertimbangan
          </button>
        </section>
      )}
    </div>
  );
}
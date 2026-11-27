type Rate =
  | { type: 'fixed' | 'starting_from'; bps: number }
  | { type: 'range'; bps: readonly [number, number, ...number[]] };

type Fee =
  | { type: 'fixed'; minor: bigint; exceptions?: boolean }
  | { type: 'percent' | 'conflicting'; bps: readonly number[]; minimumMinor: bigint }
  | { type: 'unknown' };

export type CreditRate = {
  months: number;
  minimumMinor: bigint | null;
  rate: Rate;
  fee: Fee;
};

export type CreditAccount = {
  id: string;
  name: string;
  method: 'published_flat' | 'assumed_flat' | 'manual' | 'custom_flat';
  terms: readonly CreditRate[];
  zeroInterestOption?: boolean;
};

type CreditProvider = {
  id: string;
  name: string;
  accounts: readonly [CreditAccount, ...CreditAccount[]];
  reference?: { date: string; sources: readonly [string, ...string[]] };
};

const referenceDate = '2026-11-27';
const unknownFee = { type: 'unknown' } as const;
const noFee = { type: 'fixed', minor: 0n } as const;
const waivedWithExceptions = { ...noFee, exceptions: true };
const zero = { type: 'fixed', bps: 0 } as const;
const fixed = (bps: number) => ({ type: 'fixed', bps } as const);
const range = (bps: readonly [number, number, ...number[]]) => ({ type: 'range', bps } as const);
const term = (months: number, rate: Rate, fee: Fee, minimumMinor: bigint | null = null): CreditRate =>
  ({ months, rate, fee, minimumMinor });

const shopee = (id: string, name: string, tenors: readonly number[], rate: Rate): CreditAccount => ({
  id, name, method: 'assumed_flat', zeroInterestOption: true,
  terms: tenors.map(months => term(months, months === 1 ? zero : rate, unknownFee)),
});

const premiumTenors = [1, 3, 6, 9, 12];
const premium = (id: string, name: string, tenors: readonly number[]): CreditAccount => ({
  id, name, method: 'assumed_flat',
  terms: tenors.map(months => months === 1
    ? term(months, zero, waivedWithExceptions, 0n)
    : term(months, range([199, 249, 260, 299, 399]), noFee, 50_000_000n)),
});

export const creditProviders: readonly CreditProvider[] = [
  {
    id: 'shopee', name: 'Shopee SPayLater',
    accounts: [
      shopee('starter', 'Starter', [1, 3], fixed(395)),
      shopee('classic', 'Classic', [1, 3, 6, 12], range([295, 395])),
      shopee('advanced', 'Advanced', [1, 3, 6, 12, 18, 24], fixed(245)),
      shopee('priority', 'Priority', [1, 3, 6, 12, 18, 24], fixed(195)),
    ],
    reference: { date: referenceDate, sources: ['https://spaylater.co.id/products/spaylater'] },
  },
  {
    id: 'gopay', name: 'GoPay Later — Tokopedia',
    accounts: [{
      id: 'standard', name: 'Standard', method: 'published_flat',
      terms: [
        term(1, { type: 'starting_from', bps: 200 }, unknownFee, 2_000_000n),
        term(3, { type: 'starting_from', bps: 200 }, unknownFee, 6_000_000n),
        term(6, { type: 'starting_from', bps: 275 }, unknownFee, 12_000_000n),
        term(12, { type: 'starting_from', bps: 263 }, unknownFee, 24_000_000n),
      ],
    }],
    reference: { date: referenceDate, sources: [
      'https://gopay.co.id/bantuan/gopay-later/berapa-biaya-cicilan-gopay-later',
      'https://gopay.co.id/bantuan/gopay-later/ada-berapa-pilihan-cicilan-periode-pinjaman-untuk-penggunaan-gopay-later',
      'https://gopay.co.id/bantuan/gopay-later/tentang-gopay-later-by-pt-multifinance-anak-bangsa',
    ] },
  },
  {
    id: 'kredivo', name: 'Kredivo',
    accounts: [
      { id: 'starter', name: 'Starter', method: 'assumed_flat', terms: [term(1, zero, waivedWithExceptions, 0n)] },
      { id: 'basic', name: 'Basic', method: 'assumed_flat', terms: [
        term(1, zero, waivedWithExceptions, 0n),
        term(3, fixed(400), { type: 'percent', bps: [100], minimumMinor: 100_000n }, 50_000_000n),
      ] },
      premium('premium', 'Premium', premiumTenors),
      premium('premium_plus', 'Premium Plus', [...premiumTenors, 18, 24]),
    ],
    reference: { date: referenceDate, sources: ['https://kredivo.id/faqs/umum/'] },
  },
  {
    id: 'indodana', name: 'Indodana',
    accounts: [{
      id: 'standard', name: 'Standard', method: 'published_flat',
      terms: [1, 3, 6, 12].map(months => term(months, months === 1 ? zero : fixed(300),
        { type: 'conflicting', bps: [100, 300], minimumMinor: 100_000n })),
    }],
    reference: { date: referenceDate, sources: [
      'https://www.indodana.id/faq?content=faq-bunga-paylater',
      'https://www.indodana.id/faq/berapa-besar-bunga-yang-harus-saya-bayar-dengan-pembayaran-paylater',
      'https://www.indodana.id/faq/kapan-saya-bisa-mengubah-tenor-cicilan',
    ] },
  },
  { id: 'akulaku', name: 'Akulaku', accounts: [{ id: 'standard', name: 'Standard', method: 'manual', terms: [] }] },
  { id: 'other', name: 'Other financing', accounts: [
    { id: 'custom', name: 'Custom', method: 'custom_flat', terms: [], zeroInterestOption: true },
  ] },
];

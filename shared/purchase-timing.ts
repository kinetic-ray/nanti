export const timingVersion = '1.0.0';
export const maxMoneyDigits = 18;

export type TimingInput = {
  purchaseMinor?: string;
  liquidMinor?: string;
  obligationsMinor?: string;
  reserveMinor?: string;
  extraMinor?: string;
  monthlyMinor?: string;
  targetDate?: string;
};

const requiredAmounts = {
  purchaseMinor: 'Purchase cost',
  liquidMinor: 'Liquid funds',
  obligationsMinor: 'Essential obligations',
  reserveMinor: 'Protected reserve',
} as const;
export const minorPattern = new RegExp(`^(0|[1-9][0-9]{0,${maxMoneyDigits - 1}})$`);

export function parsePlanningAmount(value: string): string | null {
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}

export function isCalendarDate(value: string) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

// Count monthly deposits on the same day, or the last day of shorter months.
function depositsBy(asOf: string, target: string) {
  const start = new Date(`${asOf}T00:00:00Z`);
  const end = new Date(`${target}T00:00:00Z`);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  return BigInt(Math.max(0, months - (end.getUTCDate() < Math.min(start.getUTCDate(), lastDay) ? 1 : 0)));
}

export function evaluateTiming(input: TimingInput, asOf: string) {
  const { targetDate } = input;
  if (!isCalendarDate(asOf) || (targetDate !== undefined && !isCalendarDate(targetDate))) {
    throw new RangeError('Enter a valid calendar date.');
  }
  const read = (key: Exclude<keyof TimingInput, 'targetDate'>) => {
    const value = input[key];
    if (value === undefined) return null;
    if (typeof value !== 'string' || !minorPattern.test(value)) throw new RangeError('Enter a valid nonnegative amount.');
    return BigInt(value);
  };
  const purchase = read('purchaseMinor');
  const liquid = read('liquidMinor');
  const obligations = read('obligationsMinor');
  const reserve = read('reserveMinor');
  const extra = read('extraMinor') ?? 0n;
  const monthly = read('monthlyMinor');
  const total = purchase === null ? null : purchase + extra;
  const available = liquid === null || obligations === null || reserve === null ? null : liquid - obligations - reserve;
  const gap = total === null || available === null ? null : total > available ? total - available : 0n;
  const months = gap === null ? null : gap === 0n ? 0n : monthly !== null && monthly > 0n
    ? (gap + monthly - 1n) / monthly : null;
  const status = gap === null ? 'Insufficient Data' : gap === 0n ? 'Buy Now' : months === null ? 'Reconsider' : 'Wait';
  const target = !targetDate ? null : targetDate < asOf ? 'past' : months === null ? 'unknown'
    : months <= depositsBy(asOf, targetDate) ? 'reachable' : 'short';
  return {
    version: timingVersion, asOf, status, target,
    missing: Object.entries(requiredAmounts).filter(([key]) => input[key as keyof TimingInput] === undefined)
      .map(([, label]) => label),
    obligationsMinor: obligations?.toString() ?? null,
    reserveMinor: reserve?.toString() ?? null,
    totalMinor: total?.toString() ?? null,
    availableMinor: available?.toString() ?? null,
    gapMinor: gap?.toString() ?? null,
    protectionShortfallMinor: available === null ? null : (available < 0n ? -available : 0n).toString(),
    months: months?.toString() ?? null,
  } as const;
}

export type TimingResult = ReturnType<typeof evaluateTiming>;

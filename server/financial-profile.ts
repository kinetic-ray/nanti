import { z } from 'zod';
import { maxFinancialAmount } from '../shared/financial-profile.js';
import type {
  AdditionalSection, DebtSection, ExpenseSection, FinancialProfile, IncomeSection,
  ReadinessSection, SavingsSection,
} from '../shared/financial-profile.js';
import { Prisma } from './generated/prisma/client.js';
import type { PrismaClient } from './generated/prisma/client.js';

const amount = z.string().regex(/^(0|[1-9]\d{0,12})$/u).refine(value => Number(value) <= maxFinancialAmount)
  .nullable();
const id = z.uuid();
const name = z.string().trim().min(1).max(80);
const date = z.iso.date().nullable();
const uniqueIds = <T extends { id: string }>(items: T[]) => new Set(items.map(item => item.id)).size === items.length;

const incomeSchema = z.strictObject({
  items: z.array(z.strictObject({ id, name, monthlyNet: amount })).max(20).refine(uniqueIds, 'Income item IDs must be unique.'),
  stability: z.enum(['steady', 'variable', 'irregular']).nullable(),
  confirmed: z.boolean(),
});
const expensesSchema = z.strictObject({
  items: z.array(z.strictObject({
    id, name, monthlyAmount: amount,
    classification: z.enum(['essential', 'obligation', 'flexible', 'unclassified']),
  })).max(40).refine(uniqueIds, 'Expense item IDs must be unique.'),
  confirmed: z.boolean(),
});
const debtsSchema = z.strictObject({
  status: z.enum(['unknown', 'none', 'listed']),
  items: z.array(z.strictObject({ id, name, monthlyAmount: amount, remainingMonths: z.number().int().min(1).max(600).nullable(), estimateDate: date })).max(20)
    .refine(uniqueIds, 'Installment item IDs must be unique.'),
}).refine(section => section.status !== 'none' || section.items.length === 0, 'A no-installment section cannot contain items.')
  .refine(section => section.status !== 'listed' || section.items.every(item => item.monthlyAmount !== null),
    'Add the monthly amount for each installment.')
  .refine(section => section.items.every(item => item.remainingMonths === null || item.estimateDate !== null),
    'Add the date used for the remaining-term estimate.');
const savingsSchema = z.strictObject({ monthlyAmount: amount });
const readinessSchema = z.strictObject({ availableCash: amount, emergencyFund: amount });
const additionalSchema = z.strictObject({
  payday: z.number().int().min(1).max(31).nullable(),
  goals: z.array(z.strictObject({ id, name, targetAmount: amount.refine(value => value !== null, 'Enter the target amount.'),
    savedAmount: amount.refine(value => value !== null, 'Enter the amount already saved.'), targetDate: date })).max(20)
    .refine(uniqueIds, 'Financial goal IDs must be unique.'),
});

const sectionSchemas = {
  income: incomeSchema,
  expenses: expensesSchema,
  debts: debtsSchema,
  savings: savingsSchema,
  readiness: readinessSchema,
  additional: additionalSchema,
} as const;

export type FinancialSection = keyof typeof sectionSchemas;
export function parseFinancialSection(section: string, input: unknown):
  | { success: true; section: FinancialSection; data: IncomeSection | ExpenseSection | DebtSection | SavingsSection | ReadinessSection | AdditionalSection }
  | { success: false } {
  if (!Object.hasOwn(sectionSchemas, section)) return { success: false };
  const key = section as FinancialSection;
  const result = sectionSchemas[key].safeParse(input);
  return result.success ? { success: true, section: key, data: result.data as
    IncomeSection | ExpenseSection | DebtSection | SavingsSection | ReadinessSection | AdditionalSection } : { success: false };
}

type StoredSection = Pick<FinancialProfile, 'income' | 'expenses' | 'debts' | 'savings' | 'readiness' | 'additional'>;

function mapProfile(row: Awaited<ReturnType<PrismaClient['financialProfile']['findUnique']>>): FinancialProfile {
  return {
    income: (row?.income ?? null) as IncomeSection | null,
    expenses: (row?.expenses ?? null) as ExpenseSection | null,
    debts: (row?.debts ?? null) as DebtSection | null,
    savings: (row?.savings ?? null) as SavingsSection | null,
    readiness: (row?.readiness ?? null) as ReadinessSection | null,
    additional: (row?.additional ?? null) as AdditionalSection | null,
    sectionUpdatedAt: {
      ...(row?.incomeUpdatedAt && { income: row.incomeUpdatedAt.toISOString() }),
      ...(row?.expensesUpdatedAt && { expenses: row.expensesUpdatedAt.toISOString() }),
      ...(row?.debtsUpdatedAt && { debts: row.debtsUpdatedAt.toISOString() }),
      ...(row?.savingsUpdatedAt && { savings: row.savingsUpdatedAt.toISOString() }),
      ...(row?.readinessUpdatedAt && { readiness: row.readinessUpdatedAt.toISOString() }),
      ...(row?.additionalUpdatedAt && { additional: row.additionalUpdatedAt.toISOString() }),
    },
    createdAt: row?.createdAt.toISOString() ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function prismaFinancialProfiles(db: PrismaClient) {
  return {
    async get(userId: string): Promise<FinancialProfile> {
      return mapProfile(await db.financialProfile.findUnique({ where: { userId } }));
    },
    async save(userId: string, section: FinancialSection, data: StoredSection[FinancialSection]): Promise<FinancialProfile> {
      const json = data as never;
      const updatedAt = new Date();
      const current = await db.financialProfile.findUnique({ where: { userId } });
      if (current && stableJson(current[section]) === stableJson(data)) return mapProfile(current);
      try {
        await db.financialProfile.upsert({
          where: { userId },
          create: { userId, [section]: json, [`${section}UpdatedAt`]: updatedAt },
          update: { [section]: json, [`${section}UpdatedAt`]: updatedAt },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        await db.financialProfile.update({ where: { userId }, data: { [section]: json, [`${section}UpdatedAt`]: updatedAt } });
      }
      return this.get(userId);
    },
    async remove(userId: string) {
      await db.financialProfile.deleteMany({ where: { userId } });
    },
  };
}

export type FinancialProfileRepository = ReturnType<typeof prismaFinancialProfiles>;

export type IncomeStability = 'steady' | 'variable' | 'irregular';
export type ExpenseClassification = 'essential' | 'obligation' | 'flexible' | 'unclassified';
export type DebtStatus = 'unknown' | 'none' | 'listed';

export type IncomeItem = { id: string; name: string; monthlyNet: string | null };
export type IncomeSection = {
  items: IncomeItem[];
  stability: IncomeStability | null;
  confirmed: boolean;
};
export type ExpenseItem = {
  id: string;
  name: string;
  monthlyAmount: string | null;
  classification: ExpenseClassification;
};
export type ExpenseSection = { items: ExpenseItem[]; confirmed: boolean };
export type DebtItem = {
  id: string;
  name: string;
  monthlyAmount: string;
  remainingMonths: number | null;
  estimateDate: string | null;
};
export type DebtSection = { status: DebtStatus; items: DebtItem[] };
export type SavingsSection = { monthlyAmount: string | null };
export type ReadinessSection = { availableCash: string | null; emergencyFund: string | null };
export type FinancialGoal = {
  id: string;
  name: string;
  targetAmount: string;
  savedAmount: string;
  targetDate: string | null;
};
export type AdditionalSection = { payday: number | null; goals: FinancialGoal[] };

export type FinancialProfile = {
  income: IncomeSection | null;
  expenses: ExpenseSection | null;
  debts: DebtSection | null;
  savings: SavingsSection | null;
  readiness: ReadinessSection | null;
  additional: AdditionalSection | null;
  sectionUpdatedAt: Partial<Record<'income' | 'expenses' | 'debts' | 'savings' | 'readiness' | 'additional', string>>;
  createdAt: string | null;
  updatedAt: string | null;
};

export const maxFinancialAmount = 1_000_000_000_000;

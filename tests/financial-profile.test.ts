import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { FinancialProfile } from '../shared/financial-profile.js';
import { authToken, tokenHash } from '../server/prisma-accounts.js';
import type { Accounts } from '../server/prisma-accounts.js';
import { financialProfileRoutes } from '../server/financial-profile-routes.js';
import { parseFinancialSection } from '../server/financial-profile.js';

const base: FinancialProfile = {
  income: null, expenses: null, debts: null, savings: null, readiness: null, additional: null,
  sectionUpdatedAt: {}, createdAt: null, updatedAt: null,
};

describe('financial profile', () => {
  it('validates non-negative integer amounts and rejects unknown input fields', () => {
    expect(parseFinancialSection('savings', { monthlyAmount: '0' }).success).toBe(true);
    expect(parseFinancialSection('savings', { monthlyAmount: '1000000000001' }).success).toBe(false);
    expect(parseFinancialSection('savings', { monthlyAmount: '-1' }).success).toBe(false);
    expect(parseFinancialSection('savings', { monthlyAmount: '1,000' }).success).toBe(false);
    expect(parseFinancialSection('savings', { monthlyAmount: '1', unknown: true }).success).toBe(false);
    expect(parseFinancialSection('debts', { status: 'none', items: [] }).success).toBe(true);
    expect(parseFinancialSection('debts', { status: 'listed', items: [{ id: crypto.randomUUID(), name: 'Motor',
      monthlyAmount: '500000', remainingMonths: 5, estimateDate: null }] }).success).toBe(false);
  });

  it('keeps financial data behind an authenticated account and saves by section', async () => {
    let saved = base;
    const profiles = {
      get: vi.fn(async () => saved),
      save: vi.fn(async (_userId: string, section: keyof FinancialProfile, data: unknown) => {
        saved = { ...saved, [section]: data, sectionUpdatedAt: { ...saved.sectionUpdatedAt, [section]: '2026-11-26T12:00:00.000Z' },
          createdAt: saved.createdAt ?? '2026-11-26T12:00:00.000Z', updatedAt: '2026-11-26T12:00:00.000Z' };
        return saved;
      }),
      remove: vi.fn(async () => { saved = base; }),
    };
    const token = authToken();
    const sessionHash = tokenHash(token);
    const accounts = { session: vi.fn(async (hash: string) => hash === sessionHash ? { userId: 'member-1' } : null) };
    const app = express().use(cookieParser(), express.json(),
      express.Router().use('/account/financial-profile', financialProfileRoutes(accounts as unknown as Accounts, profiles as never, false)));

    await request(app).get('/account/financial-profile/').expect(401);
    await request(app).put('/account/financial-profile/savings').send({ monthlyAmount: '0' }).expect(401);
    await request(app).put('/account/financial-profile/savings').set('Cookie', `nanti-user=${token}`)
      .send({ monthlyAmount: '0' }).expect(200);
    expect(profiles.save).toHaveBeenCalledWith('member-1', 'savings', { monthlyAmount: '0' });
    await request(app).put('/account/financial-profile/expenses').set('Cookie', `nanti-user=${token}`)
      .send({ items: [], confirmed: true, extra: 1 }).expect(400);
    await request(app).delete('/account/financial-profile/').set('Cookie', `nanti-user=${token}`).expect(204);
    expect(profiles.remove).toHaveBeenCalledWith('member-1');
  });
});

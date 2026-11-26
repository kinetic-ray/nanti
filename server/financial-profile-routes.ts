import { Router } from 'express';
import type { Request, Response } from 'express';
import { tokenHash } from './prisma-accounts.js';
import type { Accounts } from './prisma-accounts.js';
import type { FinancialProfileRepository } from './financial-profile.js';
import { parseFinancialSection } from './financial-profile.js';
import { z } from 'zod';

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

export function financialProfileRoutes(accounts: Accounts, profiles: FinancialProfileRepository, secure: boolean) {
  const router = Router();
  const cookieName = secure ? '__Host-nanti-user' : 'nanti-user';
  async function getUserId(request: Request) {
    const parsed = token.safeParse(request.cookies?.[cookieName]);
    if (!parsed.success) return null;
    return (await accounts.session(tokenHash(parsed.data)))?.userId ?? null;
  }
  async function authorized(req: Request, res: Response) {
    const userId = await getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Sign in to continue.' });
      return null;
    }
    return userId;
  }

  router.get('/', async (req, res) => {
    const userId = await authorized(req, res);
    if (userId) res.json(await profiles.get(userId));
  });
  router.put('/:section', async (req, res) => {
    const userId = await authorized(req, res);
    if (!userId) return;
    const parsed = parseFinancialSection(req.params.section ?? '', req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the financial details you entered.' });
    res.json(await profiles.save(userId, parsed.section, parsed.data));
  });
  router.delete('/', async (req, res) => {
    const userId = await authorized(req, res);
    if (!userId) return;
    await profiles.remove(userId);
    res.status(204).end();
  });
  return router;
}

import { expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../server/password-accounts.js';

it('uses salted hashes and rejects incorrect or malformed credentials', async () => {
  const password = 'test only long passphrase';
  const first = await hashPassword(password);
  expect(first).not.toContain(password);
  expect(await hashPassword(password)).not.toBe(first);
  await expect(verifyPassword(password, first)).resolves.toBe(true);
  await expect(verifyPassword('wrong', first)).resolves.toBe(false);
  await expect(verifyPassword(password, 'garbage')).resolves.toBe(false);
});

import { expect, it } from 'vitest';
import { requireTestDatabaseUrl } from './test-database-url.mjs';

it('permits only literal loopback MySQL connections to the named development and CI schemas', () => {
  for (const schema of ['nanti_dev', 'nanti_migration_test', 'nanti_product_test']) {
    const url = 'mysql://fixture@127.0.0.1:3306/' + schema;
    expect(requireTestDatabaseUrl(url)).toBe(url);
  }
  for (const url of [
    '',
    'mysql://fixture@db.example.test/nanti_dev',
    'mysql://fixture@localhost/nanti_dev',
    'mysql://fixture@127.0.0.1/nanti',
    'mysql://fixture@127.0.0.1/production_test',
    'mysql://fixture@127.0.0.1/nanti_dev?socketPath=fixture',
    'https://fixture@127.0.0.1/nanti_dev',
  ]) {
    expect(() => requireTestDatabaseUrl(url)).toThrow('Database tests require');
  }
});

const schemas = new Set(['/nanti_dev', '/nanti_migration_test', '/nanti_product_test']);

export function requireTestDatabaseUrl(value = process.env.TEST_DATABASE_URL) {
  const target = URL.parse(value ?? '');
  if (!value || !target || target.protocol !== 'mysql:' || target.hostname !== '127.0.0.1' ||
      !target.username || !schemas.has(target.pathname) || target.search || target.hash) {
    throw new Error('Database tests require a MySQL URL at 127.0.0.1 for nanti_dev or an approved CI schema.');
  }
  return value;
}

export const testDatabaseUrl = process.env.TEST_DATABASE_URL
  ? requireTestDatabaseUrl() : undefined;

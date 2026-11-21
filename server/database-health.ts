const databaseFailures = new Set([
  'P1000', 'P1001', 'P1002', 'P1003', 'P1008', 'P1017', 'P2021', 'P2022', 'P2024',
  'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE', 'ER_CANNOT_RETRIEVE_RSA_KEY',
  'ER_GET_CONNECTION_TIMEOUT', 'ECONNREFUSED', 'ETIMEDOUT',
  'ConnectionClosed', 'DatabaseNotReachable', 'TableDoesNotExist', 'ColumnNotFound', 'PoolTimeout',
]);

export function databaseUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, errorCode, cause } = error as { code?: string; errorCode?: string; cause?: { kind?: string; code?: string } };
  return [code, errorCode, cause?.kind, cause?.code].some(entry => entry !== undefined && databaseFailures.has(entry));
}

export const databaseProblem = {
  code: 'database_unavailable',
  error: 'Could not reach Nanti. Try again.',
};

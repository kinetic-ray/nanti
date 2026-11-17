import { connectDatabase } from './database.js';
import { indexExistingProducts } from './catalog-ingestion.js';

const url = process.env.DATABASE_URL;
if (!url?.startsWith('mysql://')) {
  console.error('Set DATABASE_URL to the intended migrated MySQL database.');
  process.exit(1);
}
const db = connectDatabase(url);
try {
  console.log(`Linked ${await indexExistingProducts(db)} saved product occurrences.`);
} catch {
  console.error('Product identity indexing failed. Confirm the database and migrations, then rerun the command.');
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}

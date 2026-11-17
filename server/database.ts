import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from './generated/prisma/client.js';

export function connectDatabase(url: string) {
  return new PrismaClient({ adapter: new PrismaMariaDb(url) });
}

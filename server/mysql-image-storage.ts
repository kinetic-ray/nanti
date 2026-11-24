import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from './generated/prisma/client.js';

const keyPattern = /^mysql\/([0-9a-f-]{36})\.jpg$/u;
export const mysqlImageId = (key: string) => keyPattern.exec(key)?.[1];
export const newMysqlImageKey = () => `mysql/${randomUUID()}.jpg`;

export class ProductImageWriteError extends Error {
  constructor(cause?: unknown) {
    super('Image upload was not verified.', { cause });
  }
}

export async function writeProductImage(db: Prisma.TransactionClient, key: string, ownerId: string, bytes: Buffer, itemId?: string,
  marketplaceIdentityId?: string) {
  const id = mysqlImageId(key);
  if (!id || !bytes.length || bytes.length > 195_000) throw new ProductImageWriteError();
  try {
    await db.productImage.create({
      data: { id, ownerId, itemId, marketplaceIdentityId, mimeType: 'image/jpeg', size: bytes.length,
        checksum: createHash('sha256').update(bytes).digest('hex'), bytes: Uint8Array.from(bytes) },
      select: { id: true },
    });
  } catch (error) {
    throw new ProductImageWriteError(error);
  }
}

export async function attachProductImage(db: Prisma.TransactionClient, key: string, ownerId: string, itemId: string) {
  const id = mysqlImageId(key);
  if (!id) throw new ProductImageWriteError();
  const { count } = await db.productImage.updateMany({ where: { id, ownerId, itemId: null }, data: { itemId } });
  if (count !== 1) throw new ProductImageWriteError();
}

export function createMysqlImageStorage(db: PrismaClient) {
  return {
    async storeJpeg(ownerId: string, bytes: Buffer) {
      const key = newMysqlImageKey();
      await writeProductImage(db, key, ownerId, bytes);
      return key;
    },
    async readJpeg(key: string, itemId: string) {
      const id = mysqlImageId(key);
      if (!id) return null;
      const row = await db.productImage.findUnique({ where: { id, itemId },
        select: { bytes: true, size: true, mimeType: true, checksum: true } });
      if (!row || row.mimeType !== 'image/jpeg' || row.size !== row.bytes.length || row.size > 195_000 ||
          createHash('sha256').update(row.bytes).digest('hex') !== row.checksum) return null;
      return Buffer.from(row.bytes);
    },
    prune() {
      return db.productImage.deleteMany({ where: { itemId: null, createdAt: { lt: new Date(Date.now() - 86_400_000) } } });
    },
  };
}

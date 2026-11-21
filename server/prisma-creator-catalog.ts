import { validateDesign } from '../shared/creator-design.js';
import type { CreatorProductInput } from '../shared/creator-catalog.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { Prisma } from './generated/prisma/client.js';

const productFields = {
  id: true, title: true, url: true, description: true, category: true, priceMinor: true,
  currency: true, hasPhoto: true,
} as const;
const orderBy = [{ createdAt: 'desc' }, { id: 'asc' }] as const;

export function prismaCreatorCatalog(db: PrismaClient) {
  return {
    profile(userId: string) {
      return db.creatorProfile.findUnique({ where: { userId }, select: { id: true } });
    },
    catalog(userId: string) {
      return db.creatorProfile.findUnique({ where: { userId }, select: {
        name: true, handle: true, publishedDesign: true,
        products: { orderBy: [...orderBy], select: { ...productFields, published: true } },
      } });
    },
    storefront(handle: string) {
      return db.creatorProfile.findUnique({
        where: { handle, publishedDesign: { not: Prisma.DbNull } },
        select: { name: true, publishedDesign: true,
          products: { where: { published: true }, orderBy: [...orderBy], select: productFields } },
      });
    },
    async save(profileId: string, id: string, input: CreatorProductInput, photo: Buffer | null | undefined, edit: boolean) {
      const data = { ...input, ...(photo !== undefined && {
        photo: photo ? Uint8Array.from(photo) : null, hasPhoto: photo !== null,
      }) };
      if (edit) return (await db.creatorProduct.updateMany({ where: { id, profileId }, data })).count === 1
        ? 'saved' : 'missing';
      return db.$transaction(async tx => {
        const created = await tx.creatorProduct.createMany({ data: { id, profileId, ...data }, skipDuplicates: true });
        if (created.count) return 'saved';
        const previous = await tx.creatorProduct.findUnique({ where: { id, profileId }, select: { ...productFields, photo: true } });
        if (!previous) return 'missing';
        const sameFields = (Object.keys(input) as Array<keyof CreatorProductInput>).every(key => input[key] === previous[key]);
        const samePhoto = previous.photo ? Boolean(photo?.equals(previous.photo)) : !photo;
        return sameFields && samePhoto ? 'saved' : 'conflict';
      });
    },
    async renameStorefront(userId: string, name: string) {
      return (await db.creatorProfile.updateMany({ where: { userId }, data: { name } })).count === 1;
    },
    async productPublication(profileId: string, id: string, published: boolean) {
      return (await db.creatorProduct.updateMany({ where: { id, profileId }, data: { published } })).count === 1;
    },
    async remove(profileId: string, id: string) {
      return (await db.creatorProduct.deleteMany({ where: { id, profileId } })).count === 1;
    },
    async storefrontPublication(userId: string, published: boolean) {
      return db.$transaction(async tx => {
        const profile = await tx.creatorProfile.findUnique({
          where: { userId }, select: { id: true, page: { select: { design: true } } },
        });
        if (!profile) return false;
        await tx.creatorProfile.update({ where: { id: profile.id }, data: {
          publishedDesign: published ? validateDesign(profile.page?.design) : Prisma.DbNull,
        } });
        return true;
      });
    },
    privatePhoto(userId: string, id: string) {
      return db.creatorProduct.findFirst({ where: { id, profile: { userId } }, select: { photo: true } });
    },
    publicPhoto(handle: string, id: string) {
      return db.creatorProduct.findFirst({
        where: { id, published: true, profile: { handle, publishedDesign: { not: Prisma.DbNull } } }, select: { photo: true },
      });
    },
  };
}

export type CreatorCatalogRepository = ReturnType<typeof prismaCreatorCatalog>;

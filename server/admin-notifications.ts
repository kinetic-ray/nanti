import type { Prisma } from './generated/prisma/client.js';

export async function notifyNewRegisteredUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.adminNotification.createMany({
    data: [{ eventKey: `user:${userId}`, kind: 'new_user', subject: 'Pengguna baru terdaftar', targetPath: '/admin?section=users' }],
    skipDuplicates: true,
  });
}

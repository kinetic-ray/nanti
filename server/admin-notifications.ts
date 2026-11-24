import type { PrismaClient } from './generated/prisma/client.js';

export async function notifyNewRegisteredUser(db: PrismaClient, userId: string) {
  await db.adminNotification.createMany({
    data: [{ eventKey: `user:${userId}`, kind: 'new_user', subject: 'Pengguna baru terdaftar', targetPath: '/admin?section=users' }],
    skipDuplicates: true,
  }).catch(() => console.error('Registration notification write failed'));
}

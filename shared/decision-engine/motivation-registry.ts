import type { MotivationId, MotivationSelection } from './types.js';
import type { FlagId } from './flag-registry.js';

export type MotivationDefinition = {
  id: MotivationId;
  label: string;
  description: string;
  initialFlags: readonly FlagId[];
  branch: string;
};

export const motivationRegistry = {
  replacement: {
    id: 'replacement',
    label: 'Mengganti barang lama',
    description: 'Barang yang sekarang sudah kurang memadai.',
    initialFlags: ['replacement_needed'],
    branch: 'ownership',
  },
  functional: {
    id: 'functional',
    label: 'Membantu aktivitas',
    description: 'Mempermudah kegiatan atau pekerjaan.',
    initialFlags: ['functional_need'],
    branch: 'impact',
  },
  comfort_safety: {
    id: 'comfort_safety',
    label: 'Lebih nyaman atau aman',
    description: 'Meningkatkan kenyamanan atau perlindungan.',
    initialFlags: [],
    branch: 'comfort_safety',
  },
  personal_satisfaction: {
    id: 'personal_satisfaction',
    label: 'Kepuasan pribadi',
    description: 'Suka tampilannya, ingin lebih percaya diri, atau sebagai hadiah untuk diri sendiri.',
    initialFlags: ['aesthetic_desire'],
    branch: 'personal',
  },
  hobby_collection: {
    id: 'hobby_collection',
    label: 'Hobi atau koleksi',
    description: 'Menikmati hobi, pengalaman baru, atau melengkapi koleksi.',
    initialFlags: ['hobby_value'],
    branch: 'hobby',
  },
  gift: {
    id: 'gift',
    label: 'Hadiah untuk orang lain',
    description: 'Memberikan sesuatu yang berarti untuk seseorang.',
    initialFlags: ['gift_intent'],
    branch: 'gift',
  },
  external_influence: {
    id: 'external_influence',
    label: 'Tertarik promo atau tren',
    description: 'Tertarik karena diskon, rekomendasi, atau tren.',
    initialFlags: [],
    branch: 'external',
  },
  unclear: {
    id: 'unclear',
    label: 'Belum tahu, cuma ingin',
    description: 'Belum menemukan alasan yang pasti.',
    initialFlags: [],
    branch: 'exploration',
  },
} as const satisfies Record<MotivationId, MotivationDefinition>;

export const motivationOptions: readonly MotivationDefinition[] =
  Object.values(motivationRegistry);

export function isMotivationId(value: unknown): value is MotivationId {
  return typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(motivationRegistry, value);
}

export function isValidMotivationSelection(
  value: unknown,
): value is MotivationSelection {
  if (!value || typeof value !== 'object') return false;

  const selection = value as Partial<MotivationSelection>;

  if (!isMotivationId(selection.primary)) return false;
  if (selection.secondary === undefined) return true;

  return isMotivationId(selection.secondary) &&
    selection.secondary !== selection.primary &&
    selection.secondary !== 'unclear';
}

export function getInitialBranch(selection: MotivationSelection): string {
  const selected =
    selection.primary === 'unclear' && selection.secondary
      ? selection.secondary
      : selection.primary;

  return motivationRegistry[selected].branch;
}
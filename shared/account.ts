export const loginProviders = ['google', 'apple'] as const;
export type LoginProvider = typeof loginProviders[number];
export type AuthPurpose = 'signin' | 'link' | 'verify';
export type AccountStatus = {
  available: LoginProvider[];
  emailDelivery?: boolean;
  account: {
    displayName: string | null;
    avatarUrl?: string | null;
    canAccessCreatorStudio?: boolean;
    email?: string | null;
    emailVerified?: boolean;
    hasPassword?: boolean;
    providers: LoginProvider[];
    recentlyVerified: boolean;
    import: { guestLists: number; accountLists: number; guestPreference: boolean } | null;
  } | null;
};

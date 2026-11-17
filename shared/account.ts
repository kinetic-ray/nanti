export const loginProviders = ['google', 'apple'] as const;
export type LoginProvider = typeof loginProviders[number];
export type AuthPurpose = 'signin' | 'link' | 'verify';
export type AccountStatus = {
  available: LoginProvider[];
  account: {
    displayName: string | null;
    providers: LoginProvider[];
    recentlyVerified: boolean;
    import: { guestLists: number; accountLists: number; guestPreference: boolean } | null;
  } | null;
};

import * as client from 'openid-client';
import { importPKCS8, SignJWT } from 'jose';
import type { AuthProvider } from './generated/prisma/client.js';

const servers = {
  google: {
    issuer: 'https://accounts.google.com',
    authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    token_endpoint: 'https://oauth2.googleapis.com/token',
    jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
  },
  apple: {
    issuer: 'https://appleid.apple.com',
    authorization_endpoint: 'https://appleid.apple.com/auth/authorize',
    token_endpoint: 'https://appleid.apple.com/auth/token',
    jwks_uri: 'https://appleid.apple.com/auth/keys',
  },
} as const;

type Attempt = { state: string; nonce: string; verifier: string | null };
type Provider = {
  authorization(attempt: Attempt): Promise<URL>;
  verify(response: URLSearchParams, attempt: Attempt): Promise<{ subject: string; displayName: string | null }>;
};

function oidc(provider: AuthProvider, origin: string, clientId: string, secret: () => Promise<string>, fetch?: client.CustomFetch): Provider {
  const apple = provider === 'apple';
  const callback = new URL(`/api/account/${provider}/callback`, origin);
  const config = new client.Configuration(servers[provider], clientId, {
    id_token_signed_response_alg: 'RS256',
    token_endpoint_auth_method: 'client_secret_post',
  }, async (...args) => client.ClientSecretPost(await secret())(...args));
  config.timeout = 8;
  if (fetch) config[client.customFetch] = fetch;
  client.enableNonRepudiationChecks(config);

  return {
    async authorization({ state, nonce, verifier }) {
      return client.buildAuthorizationUrl(config, {
        response_type: 'code',
        redirect_uri: callback.href,
        state,
        nonce,
        ...(apple ? { response_mode: 'form_post' } : { scope: 'openid profile', prompt: 'select_account' }),
        ...(verifier ? {
          code_challenge_method: 'S256',
          code_challenge: await client.calculatePKCECodeChallenge(verifier),
        } : {}),
      });
    },
    async verify(response, { state, nonce, verifier }) {
      const url = new URL(callback);
      if (!apple) url.search = response.toString();
      const redirect = apple ? new Request(url, { method: 'POST', body: response }) : url;
      const tokens = await client.authorizationCodeGrant(config, redirect, {
        expectedState: state, expectedNonce: nonce, pkceCodeVerifier: verifier ?? undefined,
      });
      const claims = tokens.claims();
      if (!claims?.sub || claims.sub.length > 255) throw new Error('Invalid OAuth subject');
      const profileName = !apple && typeof claims.name === 'string'
        ? Array.from(claims.name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()).slice(0, 100).join('') : '';
      return { subject: claims.sub, displayName: profileName || null };
    },
  };
}

export async function configureOAuth(
  env: Record<string, string | undefined>, production: boolean, fetch?: client.CustomFetch,
) {
  const google = [env.AUTH_GOOGLE_CLIENT_ID, env.AUTH_GOOGLE_CLIENT_SECRET];
  const apple = [env.AUTH_APPLE_CLIENT_ID, env.AUTH_APPLE_TEAM_ID, env.AUTH_APPLE_KEY_ID, env.AUTH_APPLE_PRIVATE_KEY_BASE64];
  const providers: Partial<Record<AuthProvider, Provider>> = {};
  if ([google, apple].some(values => values.some(Boolean) && !values.every(Boolean))) {
    throw new Error('Configure every credential for each enabled OAuth provider.');
  }
  if (![...google, ...apple].some(Boolean)) return providers;
  if (!env.AUTH_PUBLIC_ORIGIN) throw new Error('Set AUTH_PUBLIC_ORIGIN for OAuth.');
  const origin = new URL(env.AUTH_PUBLIC_ORIGIN);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (origin.href !== `${origin.origin}/` || origin.username || origin.password ||
      (origin.protocol !== 'https:' && (production || !loopback || origin.protocol !== 'http:'))) {
    throw new Error('AUTH_PUBLIC_ORIGIN must be an HTTPS origin, with HTTP allowed on loopback in development.');
  }
  if (google[0] && google[1]) {
    const secret = google[1];
    providers.google = oidc('google', origin.origin, google[0], async () => secret, fetch);
  }
  const [serviceId, teamId, keyId, encodedKey] = apple;
  if (serviceId && teamId && keyId && encodedKey) {
    if (origin.protocol !== 'https:' || !origin.hostname.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(origin.hostname) || loopback) {
      throw new Error('Apple sign-in requires a registered HTTPS domain.');
    }
    const key = await importPKCS8(Buffer.from(encodedKey, 'base64').toString(), 'ES256');
    providers.apple = oidc('apple', origin.origin, serviceId, () =>
      new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: keyId }).setIssuer(teamId)
        .setSubject(serviceId).setAudience(servers.apple.issuer).setIssuedAt().setExpirationTime('5m').sign(key), fetch);
  }
  return providers;
}

export type OAuthProviders = Awaited<ReturnType<typeof configureOAuth>>;

const copy = {
  verify: ['Verify your Nanti email', 'Verify your email to finish creating your Nanti account.', 'This link expires in 30 minutes.'],
  reset: ['Reset your Nanti password', 'Use this link to choose a new password for your Nanti account.', 'This link expires in 15 minutes.'],
  changeEmail: ['Verify your new Nanti email', 'Verify this address to finish changing your Nanti sign-in email.', 'This link expires in 30 minutes.'],
} as const;
const notices = {
  emailChanged: ['Your Nanti email changed', 'Your Nanti sign-in email changed. If this was unexpected, contact Nanti support.'],
  passwordChanged: ['Your Nanti password changed', 'Your Nanti password changed and your sessions ended. If this was unexpected, reset your password.'],
} as const;

export function transactionalAccountMail(env: NodeJS.ProcessEnv = process.env) {
  const key = env.NANTI_ACCOUNT_MAIL_API_KEY?.trim();
  const from = env.NANTI_ACCOUNT_MAIL_FROM?.trim();
  if (!key && !from) return null;
  const origin = URL.parse(env.AUTH_PUBLIC_ORIGIN ?? '');
  if (!key || !from || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(from) ||
    !origin || origin.protocol !== 'https:' || origin.href !== origin.origin + '/') {
    throw new Error('Account email requires an API key, a sender address, and an HTTPS public origin.');
  }

  async function send(email: string, subject: string, text: string) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `Nanti <${from}>`, to: [email], subject, text }),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // Provider metadata can contain recipient information or message content.
    }
    throw new Error('Account email could not be submitted.');
  }
  return Object.assign(async (email: string, kind: keyof typeof copy, token: string, creator: boolean) => {
    const link = new URL('/account', origin);
    link.searchParams.set('recovery', kind);
    if (creator) link.searchParams.set('next', 'creator');
    link.hash = new URLSearchParams({ mode: kind, token }).toString();
    const [subject, action, expiration] = copy[kind];
    const text = `Nanti\n\n${action}\n\n${link.href}\n\n${expiration}\n\nIf you did not request this email, you can ignore it.`;
    await send(email, subject, text);
  }, {
    async notice(email: string, kind: keyof typeof notices) {
      const [subject, message] = notices[kind];
      await send(email, subject, `Nanti\n\n${message}`);
    },
  });
}

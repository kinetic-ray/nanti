import { stdin, stdout, stderr } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { hashAdminPassword } from '../server/admin-credentials.ts';

async function readPassword() {
  if (!stdin.isTTY) {
    let input = '';
    stdin.setEncoding('utf8');
    for await (const chunk of stdin) {
      input += chunk;
      if (Buffer.byteLength(input, 'utf8') > 258) throw new Error('Password input is too long.');
    }
    return input.replace(/\r?\n$/u, '');
  }
  const quiet = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const prompt = createInterface({ input: stdin, output: quiet, terminal: true });
  prompt.on('SIGINT', () => {
    prompt.close();
    process.exit(130);
  });
  try {
    stderr.write('Administrator password: ');
    const password = await prompt.question('');
    stderr.write('\nRepeat password: ');
    const repeat = await prompt.question('');
    stderr.write('\n');
    if (password !== repeat) throw new Error('The passwords differ.');
    return password;
  } finally { prompt.close(); }
}

try {
  stdout.write(`${await hashAdminPassword(await readPassword())}\n`);
} catch (error) {
  stderr.write(`${error instanceof Error ? error.message : 'Could not hash the password.'}\n`);
  process.exitCode = 1;
}

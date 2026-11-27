import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const root = new URL('../dist/web/', import.meta.url);
const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  const type = { js: 'text/javascript', css: 'text/css', woff2: 'font/woff2' }[pathname.split('.').at(-1)];
  try {
    const file = await readFile(new URL(pathname.startsWith('/assets/') ? pathname.slice(1) : 'index.html', root));
    response.writeHead(200, { 'Content-Type': type ?? 'text/html; charset=utf-8' }).end(file);
  } catch {
    response.writeHead(404).end();
  }
});

const item = { id: 'lamp', name: 'Adjustable reading lamp', url: null, quantity: 2, priceMinor: 50_000_025 };
const summary = { id: 'room', name: 'Reading room', currency: 'IDR' };
const list = { ...summary, items: [item], totalMinor: '100000050', unpriced: 0 };
const profile = {
  income: { items: [{ monthlyNet: '5000000' }], stability: 'steady', confirmed: true },
  expenses: { items: [{ monthlyAmount: '2000000', classification: 'essential' }], confirmed: true },
  debts: { status: 'none', items: [] },
  savings: { monthlyAmount: '500000' },
  readiness: { availableCash: '3000000', emergencyFund: '1000000' },
};
let financialProfile = profile;

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.NANTI_BROWSER_PATH ?? (process.platform === 'win32'
      ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/chromium'),
    headless: true,
  });
  const page = await browser.newPage({
    baseURL: `http://127.0.0.1:${server.address().port}`,
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(6000);
  const errors = [];
  const profileWrites = [];
  page.on('pageerror', error => errors.push(error.stack));
  await page.addInitScript(() => localStorage.setItem('nanti.language', 'en'));
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/account/financial-profile' && request.method() !== 'GET') profileWrites.push(path);
    return route.fulfill({ json: {
      '/api/session': [summary],
      '/api/account': { account: null, available: [] },
      '/api/wishlists/room': list,
      '/api/prices/alerts': { unread: 0, alerts: [] },
      '/api/recommendations/notifications': { notices: [] },
      '/api/account/financial-profile': financialProfile,
    }[path] ?? [] });
  });

  await page.goto('/');
  await page.getByRole('heading', { name: item.name }).waitFor().catch(async error => {
    throw new Error(`${await page.locator('body').innerText()}\n${errors.join('\n')}`, { cause: error });
  });
  await page.getByRole('button', { name: `Purchase tools for ${item.name}` }).click();
  await page.getByRole('button', { name: 'Help me decide' }).click();
  const dialog = page.getByRole('dialog', { name: 'Help me decide' });
  const decision = dialog.locator('.decision-v2');
  const heading = decision.locator('h3');
  const button = name => decision.getByRole('button', { name, exact: true });
  const finishQuestions = async () => {
    for (let step = 0; step < 12 && !await decision.getByText('Purchase assessment', { exact: true }).count(); step++) {
      await decision.locator('.decision-v2-option').first().click();
    }
  };
  const focused = () => heading.evaluate(element => element === document.activeElement);
  const fit = async () => {
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await dialog.locator('.dialog-content').evaluate(element => element.scrollWidth <= element.clientWidth), true, `dialog overflow at ${width}px`);
      assert.equal(await page.locator('dialog[open]').count(), 1);
    }
  };

  assert.equal(await focused(), true);
  assert.match(await decision.locator('.decision-v2-product').innerText(), /1,000,000\.50/);
  assert.equal(await decision.locator('.product-media > span').innerText(), 'A');
  assert.equal(await button('Continue').isDisabled(), true);
  await fit();
  const motivation = decision.getByRole('button', { name: /^Membantu aktivitas/ });
  await motivation.focus();
  await page.keyboard.press('Enter');
  assert.equal(await motivation.getAttribute('aria-pressed'), 'true');
  await decision.getByLabel('Supporting reason (optional)').selectOption('replacement');
  assert.equal(await decision.getByLabel('Supporting reason (optional)').locator('option[value="functional"]').count(), 0);
  await button('Continue').click();
  await decision.getByText('Question 1', { exact: true }).waitFor();
  assert.equal(await focused(), true);
  const firstQuestion = await heading.innerText();
  await decision.locator('.decision-v2-option').first().click();
  await decision.getByText('Question 2', { exact: true }).waitFor();
  assert.equal(await focused(), true);
  await button('Back').click();
  assert.equal(await heading.innerText(), firstQuestion);
  assert.equal(await focused(), true);
  await fit();

  await finishQuestions();
  await decision.getByRole('heading', { name: 'Financial readiness' }).waitFor();
  assert.equal(await focused(), true);
  const payment = decision.getByLabel('Payment method');
  await payment.selectOption('cash');
  const impact = decision.locator('.decision-v2-financial-impact');
  assert.match(await impact.innerText(), /Estimated total payment\s+IDR\s+1,000,001\.00/);
  assert.match(await impact.innerText(), /1,999,999\.00/);
  await payment.selectOption('installment');
  const provider = decision.getByLabel('Financing provider');
  const tier = decision.getByLabel('Account tier');
  const term = decision.getByLabel('Term (months)');
  const credit = decision.getByRole('region', { name: 'Financing simulation' });
  await decision.getByRole('heading', { name: 'Financial Profile Complete' }).waitFor();
  assert.equal(await decision.getByRole('link', { name: 'Complete financial profile' }).count(), 0);
  await provider.selectOption('gopay');
  assert.equal(await tier.count(), 0);
  await term.selectOption('3');
  assert.match(await credit.innerText(), /Estimated monthly installment\s+From IDR\s+353,333\.51/);
  assert.match(await impact.innerText(), /Total payment\s+From IDR\s+1,060,000\.53/);
  assert.match(await decision.getByRole('link', { name: 'View source', exact: true }).getAttribute('href'), /gopay\.co\.id/);
  await provider.selectOption('shopee');
  await tier.selectOption('classic');
  await term.selectOption('12');
  assert.match(await credit.innerText(), /Estimated monthly installment\s+IDR.*– IDR/);
  await tier.selectOption('starter');
  assert.equal(await term.inputValue(), '');
  assert.equal(await term.locator('option[value="12"]').count(), 0);
  assert.equal(await credit.count(), 0);
  await term.selectOption('3');
  await button('Enter actual installment').click();
  const actual = decision.getByLabel('Actual monthly installment (Rp)');
  await actual.fill('1');
  await decision.getByRole('alert').filter({ hasText: 'The installments do not cover the item price.' }).waitFor();
  assert.equal(await credit.count(), 0);
  assert.equal(await actual.getAttribute('aria-invalid'), 'true');
  assert.equal(await decision.getByRole('heading', { name: 'Financial Profile Complete' }).count(), 1);
  await decision.getByText('Promotional discount', { exact: true }).click();
  await decision.getByLabel('Transaction discount (Rp)').fill('999998');
  assert.equal(await credit.count(), 0);
  await decision.getByLabel('This discount is shown in the offer.').check();
  assert.match(await impact.innerText(), /Price difference\s+-IDR\s+999,997\.50/);
  assert.equal(await impact.locator('.credit-difference-negative').count(), 1);
  await term.selectOption('1');
  assert.equal(await actual.inputValue(), '');
  await term.selectOption('3');
  await actual.fill('500000');
  assert.equal(await decision.getByLabel('Down payment (Rp)').inputValue(), '0');
  assert.equal(await actual.inputValue(), '500,000');
  assert.match(await impact.innerText(), /Total payment\s+IDR\s+1,500,000\n/);
  assert.match(await impact.innerText(), /Price difference\s+\+IDR\s+499,999\.50/);
  assert.match(await impact.innerText(), /2,000,000\n/);
  assert.equal(await impact.locator('.credit-difference-positive').count(), 1);
  assert.equal(await decision.getByText(/After repayment|Monthly overview|Monthly projection details|Projection assumptions/).count(), 0);
  await actual.fill('600000');
  assert.match(await impact.innerText(), /1,800,000\n/);
  assert.equal(await decision.getByRole('heading', { name: 'Complete your payment plan' }).count(), 0);
  await fit();
  await decision.getByText('Assessment details', { exact: true }).click();
  assert.equal(await decision.locator('details').filter({ hasText: 'Assessment details' }).getAttribute('open'), '');

  await button('Back to questions').click();
  assert.equal(await focused(), true);
  await decision.locator('.decision-v2-option').first().click();
  await button('Done').click();
  const productHeading = page.getByRole('dialog', { name: item.name }).getByRole('heading', { name: item.name });
  await productHeading.waitFor();
  await page.waitForFunction(name => document.activeElement?.textContent === name, item.name);

  financialProfile = { ...profile, income: { ...profile.income, stability: null } };
  await page.getByRole('button', { name: 'Help me decide' }).click();
  await decision.getByRole('button', { name: /^Membantu aktivitas/ }).click();
  await button('Continue').click();
  await finishQuestions();
  await payment.selectOption('installment');
  await provider.selectOption('akulaku');
  await term.fill('6');
  await actual.fill('250000');
  assert.match(await impact.innerText(), /Total payment\s+IDR\s+1,500,000\n/);
  await decision.getByText('Income stability', { exact: true }).waitFor();
  assert.equal(await decision.getByText('Monthly income', { exact: true }).count(), 0);
  financialProfile = profile;
  const popupEvent = page.waitForEvent('popup');
  await decision.getByRole('link', { name: 'Complete financial profile' }).click();
  await (await popupEvent).close();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await decision.getByRole('heading', { name: 'Financial Profile Complete' }).waitFor();
  assert.equal(await decision.getByText('Income stability', { exact: true }).count(), 0);
  financialProfile = null;
  await button('Refresh data').click();
  assert.match(await impact.innerText(), /Remaining free budget\s+Unknown/);
  await decision.getByText('Monthly income', { exact: true }).waitFor();

  assert.deepEqual(profileWrites, []);
  assert.deepEqual(errors, []);
  console.log('PASS guided purchase decision, financial impact and responsive dialog');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

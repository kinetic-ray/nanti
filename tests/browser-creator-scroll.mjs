import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const baseURL = process.env.NANTI_BROWSER_BASE_URL ?? 'http://127.0.0.1:3000';
const browser = await chromium.launch({
  executablePath: process.env.NANTI_BROWSER_PATH ??
    (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
  args: ['--disable-background-networking'],
});

async function verifyPublicStorefront(page, viewport) {
  await page.goto(new URL('/creator', baseURL).href);
  await page.locator('.creator-hero-actions').waitFor();
  await page.mouse.move(viewport.width / 2, 450);
  await page.mouse.wheel(0, 80);
  await page.waitForFunction(() => window.scrollY > 0);
  await page.locator('.creator-hero-actions a[href="/creator/demo"]').click();
  const search = page.locator('#creator-storefront-search');
  await search.click();
  const box = await search.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (const delta of [20, 40, 40, 40, 40, 40, 80, 80, -40, -40]) {
    const before = await page.evaluate(() => window.scrollY);
    const sampling = page.evaluate(() => new Promise(resolve => {
      const positions = [];
      function sample() {
        positions.push(window.scrollY);
        if (positions.length < 12) requestAnimationFrame(sample);
        else resolve(positions);
      }
      requestAnimationFrame(sample);
    }));
    await page.mouse.wheel(0, delta);
    const positions = [before, ...await sampling];
    assert.ok(Math.sign(delta) * (positions.at(-1) - before) > 0 &&
      positions.slice(1).every((top, i) => Math.sign(delta) * (top - positions[i]) >= 0),
    `${viewport.width}px standalone wheel ${delta}: ${positions.join(' → ')}`);
  }
  assert.equal(await search.evaluate(input => document.activeElement === input), true);
}

try {
  console.log(`Chromium ${browser.version()}`);
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 760 }]) {
    const mobile = viewport.width < 900;
    const page = await browser.newPage({ viewport, hasTouch: mobile });
    await page.route('https://images.unsplash.com/**', route => route.abort());
    await verifyPublicStorefront(page, viewport);
    // Keep this fixture focused on scroll behavior. The catalog browser suite
    // separately verifies Studio access and publication against MySQL.
    await page.route('**/api/account/creator', route => route.fulfill({ json: { profile: { id: 'scroll-fixture', name: 'Studio Sore' } } }));
    await page.route('**/api/account/creator/design', route => route.fulfill({ json: { design: null } }));
    await page.route('**/api/account/creator/catalog', route => route.fulfill({ json: {
      name: 'Studio Sore', handle: 'scroll-fixture', publishedDesign: null,
      products: Array.from({ length: 12 }, (_, i) => ({
        id: String(i), title: 'Product ' + i, url: 'https://example.com/product/' + i, description: '',
        category: ['Everyday', 'Desk', 'Style'][i % 3], image: null, published: true,
      })),
    } }));
    await page.goto(new URL('/creator/studio', baseURL).href);
    await page.getByRole('button', { name: 'Tampilan', exact: true }).click();
    const frame = page.locator('.studio-preview-frame');
    if (mobile) {
      await page.locator('.studio-mobile-switch button').last().click();
    } else {
      await page.locator('.studio-viewports button').last().click();
    }

    await frame.evaluate(element => {
      window.previewFrame = element;
      window.previewScrolls = [];
      element.addEventListener('scroll', () => window.previewScrolls.push(element.scrollTop), { passive: true });
    });
    const observe = () => frame.evaluate(element => new Promise(resolve => {
      // Allow the scroll listener, React update and following layout to run.
      let frames = 5;
      function sample() {
        if (--frames) requestAnimationFrame(sample);
        else resolve({
          top: element.scrollTop,
          documentTop: window.scrollY,
          sameFrame: element === window.previewFrame,
          active: document.activeElement.id,
          positions: window.previewScrolls.splice(0),
        });
      }
      requestAnimationFrame(sample);
    }));
    const wheel = async (deltas, burst = 1) => {
      const box = await frame.boundingBox();
      const x = box.x + box.width / 2;
      const y = (Math.max(0, box.y) + Math.min(viewport.height, box.y + box.height)) / 2;
      await page.mouse.move(x, y);
      for (const delta of deltas) {
        const before = await observe();
        for (let i = 0; i < burst; i++) await page.mouse.wheel(0, delta);
        const after = await observe();
        const positions = [before.top, ...after.positions, after.top];
        assert.ok(Math.sign(delta) * (after.top - before.top) > 0 &&
          positions.slice(1).every((top, i) => Math.sign(delta) * (top - positions[i]) >= 0),
        `${viewport.width}px wheel ${delta}: ${positions.join(' → ')} at ${x},${y}, document ${before.documentTop} → ${after.documentTop}`);
        assert.equal(after.documentTop, before.documentTop, 'wheel stays in preview');
        assert.equal(after.sameFrame, true, 'preview remains mounted');
      }
    };

    const previewSearch = frame.getByRole('searchbox');
    const searchId = await previewSearch.getAttribute('id');
    await previewSearch.click();
    assert.equal((await observe()).active, searchId);
    await wheel([80, 80, 80, 80, -80, -80, 80, -80, 80, -80]);
    assert.equal((await observe()).active, searchId);
    const keyboardStart = await observe();
    await page.keyboard.press('PageDown');
    await page.waitForFunction(top => window.previewFrame.scrollTop > top, keyboardStart.top);
    await page.getByRole('button', { name: 'Mobile', exact: true }).click();
    assert.notEqual((await observe()).active, searchId);
    await wheel([80, -80]);

    if (mobile) await page.locator('.studio-mobile-switch button').first().click();
    const theme = page.locator('.studio-preset-grid button').nth(1);
    await theme.click();
    await page.locator('.studio-tabs button').nth(1).click();
    await page.locator('.studio-settings .studio-choice-grid').first().locator('button').nth(1).click();
    await page.locator('.studio-tabs button').nth(3).click();
    await page.locator('.studio-font-choice').last().click();
    if (mobile) await page.locator('.studio-mobile-switch button').last().click();
    await frame.locator('.storefront-theme-utility.storefront-hero-center').waitFor();
    await wheel([80, 80, -80, -80]);
    await wheel([20, -20], 3);
    if (mobile) {
      const before = await observe();
      const session = await page.context().newCDPSession(page);
      for (const [type, y] of [['touchStart', 600], ['touchMove', 550], ['touchMove', 450], ['touchEnd', 0]]) {
        await session.send('Input.dispatchTouchEvent', {
          type, touchPoints: type === 'touchEnd' ? [] : [{ x: 190, y }],
        });
      }
      await page.waitForFunction(top => window.previewFrame.scrollTop > top, before.top);
    } else {
      await page.getByRole('button', { name: 'Desktop', exact: true }).click();
      const before = await observe();
      await page.mouse.move(915, 450);
      await page.mouse.wheel(0, 120);
      await page.waitForFunction(top => window.scrollY > top, before.documentTop);
      assert.equal((await observe()).top, 0, 'the full-height desktop preview uses document scrolling');
    }
    console.log(`${viewport.width}px preview wheel, focus, keyboard and theme update passed`);
    await page.close();
  }
} finally {
  await browser.close();
}

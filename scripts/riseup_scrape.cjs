const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'docs', 'riseup_capture');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  { name: 'home', url: 'https://input.riseup.co.il/home/current' },
];

(async () => {
  // Connect to the user's REAL Chrome over CDP (so Google sign-in works)
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('riseup')) || ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://input.riseup.co.il/home/current', { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('>>> Connected to your Chrome. Please LOG IN. Waiting for the home dashboard...');

  // Poll until logged-in dashboard content appears
  const deadline = Date.now() + 15 * 60 * 1000;
  let loggedIn = false;
  while (Date.now() < deadline) {
    try {
      const ok = await page.evaluate(() => {
        const t = document.body ? document.body.innerText : '';
        return /הוצאות משתנות|פירוט שבועי|נשאר להוציא|מה קורה החודש/.test(t) &&
               location.href.includes('/home');
      });
      if (ok) { loggedIn = true; break; }
    } catch (e) {}
    await page.waitForTimeout(2500);
  }

  if (!loggedIn) {
    console.log('>>> TIMEOUT: did not detect login. Capturing whatever is on screen.');
  } else {
    console.log('>>> Logged-in dashboard detected. Capturing...');
  }

  await page.waitForTimeout(2000);

  // Try to expand all collapsible sections to capture full content
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    // click elements that look like expanders (chevrons/arrows)
    const clickable = Array.from(document.querySelectorAll('[class*="expand"],[class*="collaps"],[aria-expanded="false"],svg'));
    for (const el of clickable.slice(0, 60)) {
      try { el.closest('button,div,li')?.click?.(); await sleep(60); } catch (e) {}
    }
  }).catch(() => {});
  await page.waitForTimeout(1500);

  for (const p of PAGES) {
    try {
      if (!page.url().includes(p.url.replace('https://input.riseup.co.il',''))) {
        await page.goto(p.url, { waitUntil: 'networkidle', timeout: 30000 }).catch(()=>{});
        await page.waitForTimeout(2500);
      }
      // full-page screenshot
      await page.screenshot({ path: path.join(OUT, `${p.name}.png`), fullPage: true });
      // rendered HTML
      const html = await page.content();
      fs.writeFileSync(path.join(OUT, `${p.name}.html`), html);
      // collect all CSS (inline + cross-origin via fetch of stylesheet text)
      const css = await page.evaluate(async () => {
        let out = '';
        for (const ss of Array.from(document.styleSheets)) {
          try {
            const rules = ss.cssRules;
            for (const r of Array.from(rules)) out += r.cssText + '\n';
          } catch (e) {
            // cross-origin; try fetch
            if (ss.href) {
              try { out += '\n/* ' + ss.href + ' */\n' + await (await fetch(ss.href)).text(); } catch (e2) {}
            }
          }
        }
        return out;
      });
      fs.writeFileSync(path.join(OUT, `${p.name}.css`), css);
      console.log(`>>> Captured ${p.name}: html=${html.length}B css=${css.length}B`);
    } catch (e) {
      console.log(`>>> ERROR capturing ${p.name}: ${e.message}`);
    }
  }

  console.log('>>> DONE. Files in docs/riseup_capture/.');
  await browser.close().catch(()=>{});
})();

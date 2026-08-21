const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'docs', 'riseup_capture');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('riseup')) || ctx.pages()[0];
  await page.bringToFront().catch(()=>{});

  // Make the window a phone width so layout matches mobile design
  const session = await ctx.newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 440, height: 900, deviceScaleFactor: 2, mobile: true,
  }).catch(()=>{});
  await page.waitForTimeout(800);

  // Close any promo modal / overlay
  await page.evaluate(() => {
    const kill = [];
    document.querySelectorAll('*').forEach(el => {
      const t = (el.innerText||'').trim();
      if (t === 'ספרו לי עוד' || t === 'X' || el.getAttribute('aria-label') === 'close') {
        const btn = el.closest('button') || el;
        if (t === 'ספרו לי עוד') return; // don't click CTA
      }
    });
    // remove fixed/absolute overlays covering the screen
    document.querySelectorAll('[class*="modal"],[class*="popup"],[class*="overlay"],[role="dialog"]').forEach(e=>e.remove());
  }).catch(()=>{});
  // also press Escape and click close buttons
  await page.keyboard.press('Escape').catch(()=>{});
  for (const sel of ['button[aria-label*="close" i]','[class*="close"]']) {
    const els = await page.$$(sel);
    for (const e of els.slice(0,3)) { await e.click().catch(()=>{}); }
  }
  await page.waitForTimeout(800);

  // Find the main scroll container (tallest scrollable element)
  const info = await page.evaluate(() => {
    let best = document.scrollingElement, bestH = 0;
    document.querySelectorAll('*').forEach(el => {
      if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 300) {
        if (el.scrollHeight > bestH) { bestH = el.scrollHeight; best = el; }
      }
    });
    best.setAttribute('data-scrollroot','1');
    return { scrollHeight: best.scrollHeight, clientHeight: best.clientHeight, tag: best.tagName };
  });
  console.log('>>> scroll root', JSON.stringify(info));

  const root = await page.$('[data-scrollroot="1"]');
  const step = 760;
  const n = Math.ceil(info.scrollHeight / step) + 1;
  for (let i = 0; i < n && i < 14; i++) {
    await page.evaluate((y) => {
      const el = document.querySelector('[data-scrollroot="1"]') || document.scrollingElement;
      el.scrollTo(0, y);
    }, i * step);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `home_${String(i).padStart(2,'0')}.png`) });
  }

  // dump clean text content of the dashboard
  const text = await page.evaluate(() => {
    const el = document.querySelector('[data-scrollroot="1"]') || document.body;
    return el.innerText;
  });
  fs.writeFileSync(path.join(OUT, 'home_text.txt'), text);

  // re-dump html after modal removed
  fs.writeFileSync(path.join(OUT, 'home_clean.html'), await page.content());

  await session.send('Emulation.clearDeviceMetricsOverride').catch(()=>{});
  console.log('>>> DONE capture2');
  await browser.close().catch(()=>{});
})();

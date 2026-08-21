const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const ctx = browser.contexts()[0];
    let page = ctx.pages().find(p => p.url().includes('riseup'));
    if (!page) {
      console.log("Riseup tab not found! Opening new tab...");
      page = await ctx.newPage();
      await page.goto('https://input.riseup.co.il/home/current', { waitUntil: 'domcontentloaded' });
    }

    console.log("Connected to Riseup tab:", page.url());

    // Inject a script to observe animations and transitions
    const animations = await page.evaluate(async () => {
      const results = {
        transitions: new Set(),
        keyframes: new Set()
      };

      // Get all elements with transitions
      const elements = document.querySelectorAll('*');
      for (const el of elements) {
        const style = window.getComputedStyle(el);
        if (style.transitionDuration && style.transitionDuration !== '0s') {
          results.transitions.add(`${el.tagName}.${el.className} -> ${style.transitionProperty} ${style.transitionDuration} ${style.transitionTimingFunction}`);
        }
        if (style.animationName && style.animationName !== 'none') {
          results.keyframes.add(`${el.tagName}.${el.className} -> ${style.animationName} ${style.animationDuration} ${style.animationTimingFunction}`);
        }
      }

      return {
        transitions: Array.from(results.transitions),
        keyframes: Array.from(results.keyframes)
      };
    });

    console.log("Animations found on page:");
    console.log(JSON.stringify(animations, null, 2));

    await browser.close();
  } catch (err) {
    console.error("Failed to connect or scrape:", err);
  }
})();

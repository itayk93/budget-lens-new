import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

(async () => {
  console.log("🚀 Launching non-headless Chrome...");
  try {
    const ctx = await chromium.launchPersistentContext(
      process.env.RISEUP_PROFILE_DIR || path.join(os.homedir(), '.riseup-profile'), 
      {
        headless: false,
        channel: 'chrome', // Use real Google Chrome to allow Google Sign-in
        args: ['--disable-blink-features=AutomationControlled'], // Bypass automation detection
        viewport: null
      }
    );

    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('https://input.riseup.co.il/home/current');
    console.log("👉 Please log in to Riseup in the opened Chrome window using Google.");
    console.log("⏳ Waiting for you to reach the dashboard...");
    
    // Wait for the user to login and the dashboard to appear
    await page.waitForFunction(() => {
      const text = document.body ? document.body.innerText : '';
      return text.includes("הוצאות משתנות") || text.includes("נשאר להוציא");
    }, undefined, { timeout: 0 }); // Wait indefinitely until user logs in

    console.log("✅ Logged in! Observing real site animations...");
    await page.waitForTimeout(3000); // Wait for animations to settle
    
    // Expand a few sections to get all animations
    await page.evaluate(async () => {
      const chevrons = document.querySelectorAll('button, [class*="expand"], svg');
      for (const el of Array.from(chevrons).slice(0, 10)) {
        try { el.click(); } catch(e) {}
      }
    });
    
    await page.waitForTimeout(2000);

    const animations = await page.evaluate(() => {
      const results = { transitions: new Set(), keyframes: new Set() };
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

    console.log("🎯 Live Animations found:");
    console.log(JSON.stringify(animations, null, 2));

    console.log("Closing browser in 5 seconds...");
    await page.waitForTimeout(5000);
    await ctx.close();
    console.log("Done.");

  } catch (err) {
    console.error("Error:", err);
  }
})();

import os from 'node:os';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'docs', 'riseup_capture');

async function run() {
  console.log("🚀 Launching Chrome...");
  try {
    const ctx = await chromium.launchPersistentContext(
      process.env.RISEUP_PROFILE_DIR || path.join(os.homedir(), '.riseup-profile'), 
      { headless: false, channel: 'chrome', viewport: { width: 1440, height: 900 } }
    );

    const page = ctx.pages()[0] || await ctx.newPage();
    page.setDefaultTimeout(0); // infinite timeout
    page.setDefaultNavigationTimeout(0);
    
    await page.goto("https://input.riseup.co.il/home/current");
    console.log("👉 Browser opened. Please go to a transaction and click 'Split' (פיצול עסקה). I will automatically detect it and capture...");

    // Wait forever until "לפצל" appears and a dialog is visible
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes('לפצל') && document.querySelector('[role="dialog"], .drawer-container, .split-transaction-modal');
    }, { timeout: 0 });

    console.log("✅ Split modal detected! Capturing...");
    await page.waitForTimeout(1000); // Wait for animation
    
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    const css = await page.evaluate(() => {
      return Array.from(document.styleSheets)
        .map(sheet => {
          try { return Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n'); } 
          catch(e) { return ''; }
        }).join('\n');
    });

    fs.writeFileSync(path.join(OUT, 'split_modal.html'), html);
    fs.writeFileSync(path.join(OUT, 'split_modal.css'), css);
    await page.screenshot({ path: path.join(OUT, 'split_modal.png'), fullPage: true });

    console.log("🎯 Capture complete! Closing browser in 3 seconds...");
    setTimeout(async () => {
      await ctx.close();
      process.exit(0);
    }, 3000);

  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

run();

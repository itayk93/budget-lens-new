import os from 'node:os';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'docs', 'riseup_capture');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

async function run() {
  console.log("🚀 Launching non-headless Chrome...");
  try {
    const ctx = await chromium.launchPersistentContext(
      process.env.RISEUP_PROFILE_DIR || path.join(os.homedir(), '.riseup-profile'), 
      {
        headless: false,
        channel: 'chrome',
        viewport: { width: 1440, height: 900 }
      }
    );

    const page = ctx.pages()[0] || await ctx.newPage();
    page.setDefaultTimeout(120000);
    page.setDefaultNavigationTimeout(120000);
    await page.goto("https://input.riseup.co.il/home/current");
    
    console.log("👉 Please click on a transaction, then click 'Split' (פיצול עסקה) in the opened Chrome window.");
    console.log("⏳ Waiting for you to open the Split Transaction modal...");

    // Wait until the word "פיצול" or something similar appears in a modal/dialog
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes('פיצול') && document.querySelector('[role="dialog"], .drawer-container');
    }, { timeout: 120000 });

    console.log("✅ Split modal detected! Capturing HTML and screenshot...");
    
    // Give it a moment to animate in
    await page.waitForTimeout(1000);
    
    const html = await page.evaluate(() => {
      // Find the modal container
      const modal = document.querySelector('.split-transaction-modal') || 
                    document.querySelector('.drawer-container') ||
                    document.querySelector('.modal-container') ||
                    document.querySelector('[role="dialog"]') ||
                    document.body;
      return modal.outerHTML;
    });

    const css = await page.evaluate(() => {
      return Array.from(document.styleSheets)
        .map(sheet => {
          try {
            return Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n');
          } catch(e) {
            return '';
          }
        }).join('\n');
    });

    fs.writeFileSync(path.join(OUT, 'split_modal.html'), html);
    fs.writeFileSync(path.join(OUT, 'split_modal.css'), css);
    await page.screenshot({ path: path.join(OUT, 'split_modal.png') });

    console.log("🎯 Capture complete! Saved to docs/riseup_capture/split_modal.*");
    
    setTimeout(async () => {
      await ctx.close();
      console.log("Done.");
      process.exit(0);
    }, 2000);

  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

run();

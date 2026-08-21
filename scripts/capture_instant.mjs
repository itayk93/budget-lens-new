import os from 'node:os';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'docs', 'riseup_capture');

async function run() {
  console.log("🚀 Attaching to existing Chrome...");
  try {
    const ctx = await chromium.launchPersistentContext(
      process.env.RISEUP_PROFILE_DIR || path.join(os.homedir(), '.riseup-profile'), 
      { headless: false, channel: 'chrome' }
    );

    const pages = ctx.pages();
    let targetPage = pages.find(p => p.url().includes('riseup'));
    if (!targetPage) {
      console.log("No riseup page found! Pages were: ", pages.map(p => p.url()));
      targetPage = pages[pages.length - 1]; // Use the most recent page
    }
    
    console.log("✅ Capturing HTML and screenshot from URL: " + targetPage.url());
    
    const html = await targetPage.evaluate(() => {
      // Return the entire document to be safe
      return document.documentElement.outerHTML;
    });

    const css = await targetPage.evaluate(() => {
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
    await targetPage.screenshot({ path: path.join(OUT, 'split_modal.png'), fullPage: true });

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

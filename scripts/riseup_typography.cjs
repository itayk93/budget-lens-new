const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('riseup'));
  await page.bringToFront().catch(()=>{});

  const data = await page.evaluate(() => {
    const out = {};
    const cs = (el) => {
      const s = getComputedStyle(el);
      return { fs: s.fontSize, fw: s.fontWeight, lh: s.lineHeight, ls: s.letterSpacing, color: s.color, va: s.verticalAlign, ff: s.fontFamily.split(',')[0] };
    };
    // find big category title
    const titles = [...document.querySelectorAll('*')].filter(e => /^(סופר|פארמה|בתי קפה|אוכל בחוץ|הוצאות משתנות|הכנסות)$/.test((e.textContent||'').trim()) && e.children.length===0);
    if (titles[0]) out.title = { text: titles[0].textContent.trim(), ...cs(titles[0]) };
    // find amount like 961.8 — element containing ₪
    const amounts = [...document.querySelectorAll('*')].filter(e => /\d[\d,]*\.\d/.test((e.textContent||'')) && (e.textContent||'').includes('₪') && e.textContent.length < 18);
    // pick smallest leaf-ish
    amounts.sort((a,b)=> (a.textContent.length-b.textContent.length));
    const amt = amounts.find(a=>a.querySelectorAll('*').length<=4) || amounts[0];
    if (amt) {
      out.amount = { text: amt.textContent.trim(), ...cs(amt), tag: amt.tagName };
      // inspect children (integer / decimal / shekel parts)
      out.amountChildren = [...amt.querySelectorAll('*')].slice(0,6).map(c => ({ text: c.textContent.trim().slice(0,8), ...cs(c) }));
    }
    // labels like יצא / צפוי לצאת
    const lbl = [...document.querySelectorAll('*')].find(e => (e.textContent||'').trim()==='יצא' && e.children.length===0);
    if (lbl) out.label = { text:'יצא', ...cs(lbl) };
    const rem = [...document.querySelectorAll('*')].find(e => /נשאר להוציא/.test((e.textContent||'')) && e.children.length<=3);
    if (rem) out.remaining = { text: rem.textContent.trim().slice(0,20), ...cs(rem) };
    out.bodyFont = getComputedStyle(document.body).fontFamily;
    return out;
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close().catch(()=>{});
})();

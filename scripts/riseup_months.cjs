const { chromium } = require('playwright');
(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9222');
  const page = b.contexts()[0].pages().find(p => p.url().includes('riseup'));
  await page.bringToFront().catch(()=>{});

  const readMonth = async () => {
    return await page.evaluate(() => {
      const txt = document.body.innerText;
      // current month label
      const monthMatch = txt.match(/(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)\s*\n?\s*(\d{4})/);
      const grab = (label) => {
        // find a section header then the nearby numbers
        return null;
      };
      // Pull all "label: number ₪" style blocks by scanning section cards
      const cards = [...document.querySelectorAll('*')].filter(e => /הכנסות|הוצאות קבועות|הוצאות משתנות|לא בתזרים|סך כל ההוצאות/.test(e.textContent||'') );
      return { month: monthMatch ? monthMatch[1]+' '+monthMatch[2] : '?', text: txt.slice(0, 6000) };
    });
  };

  // find the "previous month" arrow (older). Riseup: two arrow buttons around the month label.
  const goPrev = async () => {
    const clicked = await page.evaluate(() => {
      // arrows are near the month label; find svgs/buttons in the top area
      const btns = [...document.querySelectorAll('button, [role="button"], svg')].filter(e => {
        const r = e.getBoundingClientRect();
        return r.top < 220 && r.top > 40 && r.width < 80 && r.width > 10;
      });
      // rightmost clickable in that band = previous (older) in RTL
      btns.sort((a,b)=> b.getBoundingClientRect().left - a.getBoundingClientRect().left);
      const target = btns[0];
      if (target) { (target.closest('button')||target).dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; }
      return false;
    });
    await page.waitForTimeout(1200);
    return clicked;
  };

  const target = process.argv[2] || 'יולי 2025';
  let cur = await readMonth();
  console.log('START month:', cur.month);
  for (let i = 0; i < 18; i++) {
    if (cur.month === target) break;
    await goPrev();
    cur = await readMonth();
    console.log('-> now', cur.month);
  }
  console.log('=== FINAL', cur.month, '===');
  console.log(cur.text);
  await b.close().catch(()=>{});
})();

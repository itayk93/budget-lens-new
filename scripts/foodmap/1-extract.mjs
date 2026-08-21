// Step 1: pull food transactions from Supabase -> data/food-transactions.csv
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const FOOD_CATEGORIES = ['בתי קפה', 'אוכל בחוץ', 'סופר', 'פנאי ובילויים', 'יין'];

// merchants that are payment rails / clubs / vouchers, not physical places
const NON_PLACE = [
  /^PAYBOX/i, /^BIT$/i, /העברה ב ?BIT/, /ביט /, /מועדון ביטוח ישיר/, /רכישות שובר/,
  /^WOLT/i, /^TENBIS/i, /תן ביס/, /^PAYPAL/i, /^GOOGLE/i, /^APPLE/i, /^GETT/i,
  /^AMAZON/i, /קרנף פועלים/, /^MTS PRONTO/i, /^OPEN PAY/i, /העברה/, /זיכוי/,
  /מועדון/, /^SUMIT/i, /^CARDCOM/i, /^MESHULAM/i, /משולם/, /^BUYME/i, /^ICOUNT/i,
];

const norm = (s) => String(s ?? '')
  .replace(/\s+/g, ' ')
  .replace(/["״'׳]/g, '')
  .replace(/\s*בע"?מ\s*$/i, '')
  .replace(/\s*בעמ\s*$/i, '')
  .replace(/\s+(IL|TEL AVIV|tel aviv)\s*$/i, '')
  .trim();

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET;
  if (!url || !key) throw new Error('missing SUPABASE_URL / SUPABASE_SECRET');
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id,business_name,category_name,amount,currency,payment_date,charge_date,payment_method')
      .range(from, from + 999);
    if (error) throw error;
    rows = rows.concat(data);
    if (data.length < 1000) break;
  }

  const food = rows
    .filter((r) => FOOD_CATEGORIES.includes(r.category_name))
    .map((r) => ({
      id: r.id,
      raw_name: (r.business_name || '').trim(),
      name: norm(r.business_name),
      category: r.category_name,
      amount: Math.abs(Number(r.amount) || 0),
      currency: r.currency || 'ILS',
      date: r.payment_date || r.charge_date || '',
      payment_method: r.payment_method || '',
    }))
    // Punctuation-only merchant names are not places; they geocode to junk pins.
    .filter((r) => r.name && r.date && /\p{L}/u.test(r.name))
    .filter((r) => !NON_PLACE.some((re) => re.test(r.raw_name)));

  const header = ['id', 'raw_name', 'name', 'category', 'amount', 'currency', 'date', 'payment_method'];
  const out = [header.join(',')]
    .concat(food.map((r) => header.map((h) => csvCell(r[h])).join(',')))
    .join('\n');

  const dest = path.resolve('data/food-transactions.csv');
  fs.writeFileSync(dest, '﻿' + out);

  const uniq = new Set(food.map((r) => r.name));
  console.log(`transactions: ${rows.length}`);
  console.log(`food rows kept: ${food.length}`);
  console.log(`unique merchants: ${uniq.size}`);
  console.log(`-> ${dest}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });

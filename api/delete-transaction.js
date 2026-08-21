const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

function reply(res, status, body) {
  Object.entries(JSON_HEADERS).forEach(([name, value]) => res.setHeader(name, value));
  return res.status(status).json(body);
}

async function supabaseRequest(path, options = {}) {
  const baseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET;
  if (!baseUrl || !serviceKey) throw new Error('Server configuration is incomplete');

  return fetch(`${baseUrl.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(8000),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed' });

  try {
    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    if (!id) return reply(res, 400, { error: 'transaction id is required' });

    const lookup = await supabaseRequest(
      `transactions?select=id,user_id,business_name,bank_scraper_source_id&id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    if (!lookup.ok) throw new Error(`Transaction lookup failed (${lookup.status})`);
    const rows = await lookup.json();
    const transaction = rows[0];
    if (!transaction) return reply(res, 404, { error: 'Transaction not found' });

    let ignored = false;
    if (transaction.bank_scraper_source_id) {
      const ignoredResponse = await supabaseRequest('bank_scraper_ignored_transactions?on_conflict=user_id,bank_scraper_source_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          user_id: transaction.user_id,
          bank_scraper_source_id: transaction.bank_scraper_source_id,
          reason: 'user_deleted',
          notes: transaction.business_name || null,
        }),
      });
      if (!ignoredResponse.ok) throw new Error(`Delete marker failed (${ignoredResponse.status})`);
      ignored = true;
    }

    const deletedResponse = await supabaseRequest(`transactions?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    if (!deletedResponse.ok) throw new Error(`Transaction delete failed (${deletedResponse.status})`);
    const deleted = await deletedResponse.json();
    return reply(res, 200, { deleted: deleted.length, ignored });
  } catch (error) {
    console.error('delete-transaction failed', error);
    return reply(res, 500, { error: error?.message || 'Delete transaction failed' });
  }
}

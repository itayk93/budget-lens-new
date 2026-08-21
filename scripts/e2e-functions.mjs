#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Safe endpoint E2E smoke runner.
 * Default: negative/auth/validation paths only. Mutating cases require explicit opt-in.
 */
const baseUrl = (process.env.E2E_BASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const apiBaseUrl = (process.env.E2E_API_BASE_URL || baseUrl).replace(/\/$/, '');
const accessToken = process.env.E2E_ACCESS_TOKEN || '';
const allowMutations = process.env.E2E_MUTATIONS === 'true';
const skipApi = process.env.E2E_SKIP_API === 'true';

if (!baseUrl) {
  console.error('E2E_BASE_URL or VITE_SUPABASE_URL required');
  process.exit(2);
}

const edgeFunctions = readdirSync(join(process.cwd(), 'supabase/functions'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => readdirSync(join(process.cwd(), 'supabase/functions', entry.name)).includes('index.ts'))
  .map((entry) => entry.name)
  .sort();

if (!edgeFunctions.length) {
  console.error('No supabase/functions/*/index.ts files found');
  process.exit(2);
}

const checks = [
  ...edgeFunctions.flatMap((name) => [
    { name: `${name} CORS preflight`, path: `/functions/v1/${name}`, method: 'OPTIONS', expected: [200, 204] },
    { name: `${name} unauthenticated`, path: `/functions/v1/${name}`, body: {}, expected: [401] },
  ]),
  { name: 'leads rejects invalid input', path: '/api/leads', body: {}, expected: [400] },
  { name: 'delete-transaction rejects wrong method', path: '/api/delete-transaction', method: 'GET', expected: [405] },
  { name: 'delete-transaction rejects missing id', path: '/api/delete-transaction', body: {}, expected: [400] },
  { name: 'import-transactions-csv rejects empty body', path: '/api/import-transactions-csv', body: {}, expected: [400] },
  { name: 'delete-transactions-months rejects empty body', path: '/api/delete-transactions-months', body: {}, expected: [400] },
];

if (skipApi) {
  for (let i = checks.length - 1; i >= 0; i -= 1) {
    if (checks[i].path.startsWith('/api/')) checks.splice(i, 1);
  }
}

if (allowMutations && accessToken) {
  checks.push(
    { name: 'suggest-title authenticated', path: '/functions/v1/suggest-title', body: { fileName: 'e2e-test.png', fileType: 'image/png', width: 1, height: 1 }, expected: [200], auth: true },
    { name: 'suggest-tags authenticated', path: '/functions/v1/suggest-tags', body: { fileName: 'e2e-test.png', fileType: 'image/png' }, expected: [200], auth: true },
  );
}

let failed = 0;
for (const check of checks) {
  const targetBaseUrl = check.path.startsWith('/api/') ? apiBaseUrl : baseUrl;
  let response;
  try {
    response = await fetch(`${targetBaseUrl}${check.path}`, {
      method: check.method || 'POST',
      headers: { 'content-type': 'application/json', ...(check.auth ? { authorization: `Bearer ${accessToken}` } : {}) },
      body: ['GET', 'OPTIONS'].includes(check.method) ? undefined : JSON.stringify(check.body ?? {}),
    });
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${check.name}: network error`);
    console.error(error instanceof Error ? error.message : String(error));
    continue;
  }
  const ok = check.expected.includes(response.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${check.name}: ${response.status} (expected ${check.expected.join('/')})`);
  if (!ok) {
    failed += 1;
    console.error((await response.text()).slice(0, 300));
  }
}

if (allowMutations && !accessToken) console.warn('E2E_MUTATIONS=true but E2E_ACCESS_TOKEN missing; skipped authenticated cases');
console.log(`E2E: ${checks.length - failed}/${checks.length} passed`);
process.exitCode = failed ? 1 : 0;

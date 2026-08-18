/*
 * Supabase access for the submission API.
 *
 * Two distinct credentials are used and must not be confused:
 *   - the anon key verifies a caller's access token (safe, also public)
 *   - the service role key writes rows and files (bypasses RLS, server only)
 *
 * The service role key must never be sent to a browser or placed in the
 * config served by api.tarmacq.com.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TABLE = process.env.SUPABASE_TABLE || 'jseo_submissions';
const BUCKET = process.env.SUPABASE_BUCKET || 'jseo-resumes';

function isConfigured() {
  return Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY);
}

/**
 * Resolves an access token to a Supabase user.
 *
 * This is the security boundary for the whole submission flow: the browser
 * sends a token, and only what this function returns is trusted afterwards.
 * Anything the form claims about identity is ignored.
 */
async function verifyAccessToken(token) {
  if (!token) return null;

  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }
    });
  } catch (err) {
    console.error('Supabase auth unreachable:', err);
    throw Object.assign(new Error('AUTH_UNREACHABLE'), { code: 'AUTH_UNREACHABLE' });
  }

  if (response.status === 401 || response.status === 403) return null;

  if (!response.ok) {
    console.error('Supabase auth returned', response.status);
    throw Object.assign(new Error('AUTH_UNREACHABLE'), { code: 'AUTH_UNREACHABLE' });
  }

  const user = await response.json();
  if (!user || !user.id || !user.email) return null;

  return { id: user.id, email: user.email };
}

/** Uploads the abstract file to a private bucket. Returns the object path. */
async function uploadFile(path, file) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(path)}`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': file.mimeType || 'application/octet-stream',
        'x-upsert': 'false'
      },
      body: file.content
    }
  );

  if (!response.ok) {
    throw new Error(`storage ${response.status}: ${await response.text()}`);
  }

  return path;
}

/** Inserts the submission row. Returns the created record. */
async function insertSubmission(row) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  });

  if (!response.ok) {
    throw new Error(`insert ${response.status}: ${await response.text()}`);
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

module.exports = { isConfigured, verifyAccessToken, uploadFile, insertSubmission, BUCKET, TABLE };

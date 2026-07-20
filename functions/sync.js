// functions/sync.js
// Handles cloud sync of farm data for Sugarcane Farm Manager.
// GET  -> returns the signed-in user's saved farm_data row
// POST -> upserts the full farm_data JSON payload for the signed-in user
//
// Auth: expects "Authorization: Bearer <supabase_access_token>" from the client.
// The service_role key never leaves this function — it is only used server-side
// to verify the token and perform the DB read/write.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  /* ── TEMPORARY DIAGNOSTICS — remove once auth is confirmed working ──
     Visible in Netlify: Site → Functions → sync → Logs (server-side,
     NOT the browser console). Never logs the actual service key. */
  console.log('[sync.js] env check', {
    SUPABASE_URL: SUPABASE_URL || null,
    hasServiceKey: !!SUPABASE_SERVICE_KEY,
    serviceKeyLength: SUPABASE_SERVICE_KEY ? SUPABASE_SERVICE_KEY.length : 0,
    httpMethod: event.httpMethod,
  });
  /* ── end diagnostics ─────────────────────────────────────────────── */

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('sync.js: missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
    return jsonResponse(500, { error: 'Server misconfigured: missing Supabase environment variables' });
  }

  // Extract and validate the bearer token
  const authHeader = event.headers.authorization || event.headers.Authorization;

  /* ── TEMPORARY DIAGNOSTICS ── */
  console.log('[sync.js] auth header check', {
    headerPresent: !!authHeader,
    headerPrefix: authHeader ? authHeader.slice(0, 20) + '…' : null,
    startsWithBearer: authHeader ? authHeader.startsWith('Bearer ') : null,
  });
  /* ── end diagnostics ── */

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse(401, { error: 'Missing or malformed Authorization header' });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return jsonResponse(401, { error: 'Missing bearer token' });
  }

  // Service-role client — used only inside this function, never exposed to the browser
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify the JWT belongs to a real, current Supabase user.
  // Log the *actual* reason server-side (visible in Netlify function logs)
  // without leaking it to the client — "invalid JWT" vs "expired" vs an
  // audience/issuer mismatch look identical from the browser otherwise.
  const { data: userResult, error: userError } = await supabaseAdmin.auth.getUser(token);

  /* ── TEMPORARY DIAGNOSTICS — full getUser() result ── */
  console.log('[sync.js] getUser() result', {
    hasUser: !!userResult?.user,
    userId: userResult?.user?.id || null,
    userErrorFull: userError ? JSON.stringify(userError, Object.getOwnPropertyNames(userError)) : null,
  });
  /* ── end diagnostics ── */

  if (userError || !userResult?.user) {
    console.error('sync.js: token verification failed', {
      message: userError?.message,
      status: userError?.status,
      name: userError?.name,
      supabaseUrlUsed: SUPABASE_URL,
      tokenPrefix: token.slice(0, 20) + '...', // enough to spot obviously-wrong tokens, never the full JWT
    });
    return jsonResponse(401, { error: 'Invalid or expired token' });
  }
  const userId = userResult.user.id;

  try {
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('farm_data')
        .select('data, updated_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('sync.js GET error:', error);
        return jsonResponse(500, { error: 'Failed to load farm data' });
      }

      if (!data) {
        // No row yet for this user — not an error, just nothing to restore
        return jsonResponse(200, { data: null, updated_at: null });
      }

      return jsonResponse(200, { data: data.data, updated_at: data.updated_at });
    }

    if (event.httpMethod === 'POST') {
      let payload;
      try {
        payload = JSON.parse(event.body || '{}');
      } catch (e) {
        return jsonResponse(400, { error: 'Invalid JSON body' });
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return jsonResponse(400, { error: 'Request body must be a JSON object of localStorage data' });
      }

      const nowIso = new Date().toISOString();

      const { error } = await supabaseAdmin
        .from('farm_data')
        .upsert(
          {
            user_id: userId,
            data: payload,
            updated_at: nowIso,
          },
          { onConflict: 'user_id' }
        );

      if (error) {
        console.error('sync.js POST error:', error);
        return jsonResponse(500, { error: 'Failed to save farm data' });
      }

      return jsonResponse(200, { success: true, synced_at: nowIso });
    }

    return jsonResponse(405, { error: `Method ${event.httpMethod} not allowed` });
  } catch (err) {
    console.error('sync.js unexpected error:', err);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};

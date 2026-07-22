// functions/pest-declare.js
// Shared, cross-farm dataset -- NOT the per-user farm_data table. POST
// records one farmer's declared pest sighting; GET returns everyone's
// recent declarations so every farmer's map shows the whole community's
// reports, not just their own. Works with or without sign-in (same as the
// error/event logging in log.js). Declarations are anonymized on read --
// user_id is stored for provenance/abuse-tracing only and is never
// returned by GET.

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
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('pest-declare.js: missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
    return jsonResponse(500, { error: 'Server misconfigured: missing Supabase environment variables' });
  }
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (event.httpMethod === 'GET') {
    // Last 180 days is enough for a "current spread" picture without the
    // table -- or the map -- accumulating stale, years-old pins forever.
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from('pest_declarations')
      .select('pest_id, lat, lng, declared_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      console.error('pest-declare.js GET error:', error);
      return jsonResponse(500, { error: 'Failed to load pest declarations' });
    }
    return jsonResponse(200, {
      declarations: data.map((d) => ({ pestId: d.pest_id, lat: d.lat, lng: d.lng, date: d.declared_at })),
    });
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: `Method ${event.httpMethod} not allowed` });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }
  const { pestId, lat, lng, date } = body;
  if (!pestId || typeof lat !== 'number' || typeof lng !== 'number' || !date) {
    return jsonResponse(400, { error: 'Missing pestId, lat, lng, or date' });
  }

  let userId = null;
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) {
      const { data: userResult } = await supabaseAdmin.auth.getUser(token);
      if (userResult?.user) userId = userResult.user.id;
    }
  }

  const { error } = await supabaseAdmin.from('pest_declarations').insert({
    user_id: userId,
    pest_id: pestId,
    lat,
    lng,
    declared_at: date,
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.error('pest-declare.js POST error:', error);
    return jsonResponse(500, { error: 'Failed to record pest declaration' });
  }
  return jsonResponse(200, { success: true });
};

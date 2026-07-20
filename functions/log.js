// functions/log.js
// Body shape sent by the frontend is ALWAYS: { type: "...", payload: { ...fields } }
// Handles four types:
//   "error"          -> insert into error_logs      (payload: message, stack, app_version, user_agent, url)
//   "event"          -> insert into events           (payload: event_name, properties, app_version)
//   "profile"        -> upsert into profiles         (payload: id, consent_given, consent_at, farm_name, location, lat, lng, area_unit)
//   "delete_account" -> deletes the user's data + auth account (requires a valid Authorization token)
//
// error/event logging works with or without a signed-in user (userId will be
// null for anonymous/offline usage). profile/delete_account require auth.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: `Method ${event.httpMethod} not allowed` });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('log.js: missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
    return jsonResponse(500, { error: 'Server misconfigured: missing Supabase environment variables' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const { type, payload } = body;
  if (!type) {
    return jsonResponse(400, { error: 'Missing "type" field (expected: error | event | profile | delete_account)' });
  }
  const p = payload || {};

  /* ── TEMPORARY DIAGNOSTICS — remove once auth/schema issues are confirmed
     fixed. Visible in Netlify: Site → Functions → log → Logs. ── */
  console.log('[log.js] env check', {
    SUPABASE_URL: SUPABASE_URL || null,
    hasServiceKey: !!SUPABASE_SERVICE_KEY,
    type,
    payloadKeys: Object.keys(p),
  });
  /* ── end diagnostics ── */

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolve the user if a bearer token is present. Not required for error/event.
  let userId = null;
  const authHeader = event.headers.authorization || event.headers.Authorization;

  /* ── TEMPORARY DIAGNOSTICS ── */
  console.log('[log.js] auth header check', {
    headerPresent: !!authHeader,
    headerPrefix: authHeader ? authHeader.slice(0, 20) + '…' : null,
  });
  /* ── end diagnostics ── */

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) {
      const { data: userResult, error: userError } = await supabaseAdmin.auth.getUser(token);

      /* ── TEMPORARY DIAGNOSTICS ── */
      console.log('[log.js] getUser() result', {
        hasUser: !!userResult?.user,
        userErrorFull: userError ? JSON.stringify(userError, Object.getOwnPropertyNames(userError)) : null,
      });
      /* ── end diagnostics ── */

      if (userResult?.user) {
        userId = userResult.user.id;
      }
    }
  }

  try {
    switch (type) {
      case 'error': {
        const { message, stack, app_version, user_agent, url } = p;
        const { error } = await supabaseAdmin.from('error_logs').insert({
          user_id: userId,
          message: message || 'Unknown error',
          stack: stack || null,
          app_version: app_version || null,
          user_agent: user_agent || null,
          url: url || null,
          created_at: new Date().toISOString(),
        });
        if (error) {
          console.error('log.js error_logs insert error:', error);
          return jsonResponse(500, { error: 'Failed to record error log' });
        }
        return jsonResponse(200, { success: true });
      }

      case 'event': {
        const { event_name, properties, app_version } = p;
        if (!event_name) {
          return jsonResponse(400, { error: 'Missing "event_name" field for event' });
        }
        const { error } = await supabaseAdmin.from('events').insert({
          user_id: userId,
          name: event_name,
          properties: properties || {},
          app_version: app_version || null,
          created_at: new Date().toISOString(),
        });
        if (error) {
          console.error('log.js events insert error:', error);
          return jsonResponse(500, { error: 'Failed to record event' });
        }
        return jsonResponse(200, { success: true });
      }

      case 'profile': {
        if (!userId) {
          return jsonResponse(401, { error: 'Valid Authorization token required to upsert profile' });
        }
        const { consent_given, consent_at, farm_name, location, lat, lng, area_unit } = p;

        const updateData = { id: userId, updated_at: new Date().toISOString() };
        if (consent_given !== undefined) updateData.consent_given = consent_given;
        if (consent_at !== undefined) updateData.consent_at = consent_at;
        if (farm_name !== undefined) updateData.farm_name = farm_name;
        if (location !== undefined) updateData.location = location;
        if (lat !== undefined) updateData.lat = lat;
        if (lng !== undefined) updateData.lng = lng;
        if (area_unit !== undefined) updateData.area_unit = area_unit;

        const { error } = await supabaseAdmin
          .from('profiles')
          .upsert(updateData, { onConflict: 'id' });

        if (error) {
          console.error('log.js profiles upsert error:', error);
          return jsonResponse(500, { error: 'Failed to upsert profile' });
        }
        return jsonResponse(200, { success: true });
      }

      case 'delete_account': {
        if (!userId) {
          return jsonResponse(401, { error: 'Valid Authorization token required to delete account' });
        }
        // Best-effort cleanup of app data, then delete the auth user itself.
        const { error: farmDataError } = await supabaseAdmin.from('farm_data').delete().eq('user_id', userId);
        if (farmDataError) console.error('log.js delete_account: farm_data cleanup error:', farmDataError);

        const { error: profileError } = await supabaseAdmin.from('profiles').delete().eq('id', userId);
        if (profileError) console.error('log.js delete_account: profiles cleanup error:', profileError);

        const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (authDeleteError) {
          console.error('log.js delete_account: auth user deletion error:', authDeleteError);
          return jsonResponse(500, { error: 'Failed to delete account' });
        }
        return jsonResponse(200, { success: true });
      }

      default:
        return jsonResponse(400, { error: `Unknown type "${type}" (expected: error | event | profile | delete_account)` });
    }
  } catch (err) {
    console.error('log.js unexpected error:', err);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};

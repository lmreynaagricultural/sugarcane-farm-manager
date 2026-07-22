// functions/pest-scan.js
// Stateless: takes a base64 photo, asks Claude to match it against a short
// reference list of Philippine sugarcane pests, returns a best-guess id.
// No Supabase/auth involved -- this doesn't need to know who the farmer is,
// just needs to classify a photo, so it works whether or not they're signed in.
//
// PEST_REFERENCE below is a condensed, hand-kept-in-sync copy of the
// PEST_DATABASE ids/names/symptoms in index.html -- there's no shared module
// between the two (no build step in this project), so if pests are added or
// renamed in index.html, mirror the change here too.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const PEST_REFERENCE = [
  { id: 'rssi', name: 'Red-striped soft scale insect (RSSI)', hint: 'Sap-sucking scale insect on leaves, sticky honeydew, black sooty mold, starts on lower leaves and spreads upward. Currently the dominant real outbreak in Philippine sugarcane (2026).' },
  { id: 'whitegrub', name: 'White grub', hint: 'White C-shaped larva in the soil around roots; yellowing/stunted or toppled cane.' },
  { id: 'borer', name: 'Sugarcane stem borer', hint: '"Dead heart" -- dead central young shoot, small entry holes near the base of young stalks.' },
  { id: 'rats', name: 'Rats/rodents', hint: 'Gnawed or hollowed stalks near the base, chew marks.' },
  { id: 'aphid', name: 'Sugarcane/yellow aphid', hint: 'Small clusters of tiny insects under leaves, honeydew, localized yellowing.' },
  { id: 'mealybug', name: 'Pink sugarcane mealybug', hint: 'White cottony wax masses at leaf sheaths and stalk nodes.' },
  { id: 'leafhopper', name: 'Sugarcane leafhopper', hint: 'Pale yellow-white mottled "hopper burn" on leaves, small jumping insects.' },
  { id: 'lacebug', name: 'Sugarcane lace bug', hint: 'Fine lace-like stippled pattern on the underside of leaves.' },
  { id: 'termite', name: 'Termites', hint: 'Hollowed stalk near the soil line, mud tunnels on the stem surface.' },
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: `Method ${event.httpMethod} not allowed` });
  }
  if (!ANTHROPIC_API_KEY) {
    console.error('pest-scan.js: missing ANTHROPIC_API_KEY env var');
    return jsonResponse(500, { error: 'Server misconfigured: missing ANTHROPIC_API_KEY' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const image = body.image;
  if (!image || typeof image !== 'string') {
    return jsonResponse(400, { error: 'Missing "image" field (expected a data: URL)' });
  }
  const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!match) {
    return jsonResponse(400, { error: 'Image must be a base64 data URL (image/jpeg, image/png, or image/webp)' });
  }
  const [, mediaType, base64Data] = match;

  const pestListText = PEST_REFERENCE.map((p) => `- ${p.id}: ${p.name} — ${p.hint}`).join('\n');
  const prompt = `You are helping a Philippine sugarcane smallholder identify a pest from a phone photo. Compare the photo ONLY against this list:\n${pestListText}\n\nRespond with ONLY a single JSON object, no markdown fences, no extra text, in exactly this shape:\n{"pestId": "<one of the ids above, or null if none clearly match>", "confidence": "high" | "medium" | "low", "reasoning": "<one short plain-language sentence for a farmer>"}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('pest-scan.js: Anthropic API error', res.status, errText);
      return jsonResponse(502, { error: 'Pest analysis service unavailable, try again later' });
    }

    const result = await res.json();
    const text = result.content && result.content[0] && result.content[0].text;
    let parsed;
    try {
      parsed = JSON.parse((text || '').trim());
    } catch (e) {
      console.error('pest-scan.js: could not parse model output as JSON:', text);
      return jsonResponse(502, { error: 'Could not parse pest analysis result' });
    }

    const pest = PEST_REFERENCE.find((p) => p.id === parsed.pestId) || null;
    return jsonResponse(200, {
      pestId: pest ? pest.id : null,
      confidence: parsed.confidence || 'low',
      reasoning: parsed.reasoning || '',
    });
  } catch (err) {
    console.error('pest-scan.js unexpected error:', err);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};

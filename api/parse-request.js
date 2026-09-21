// Parses a raw partner message (a request for an offer) into a compact, uniform
// one-line summary for the "notes" ("новый формат") field on the Requests page.
// Called from the desktop request-detail "Распознать (ИИ)" button.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const SYSTEM_PROMPT = `You extract structured fields from a raw message where an affiliate partner is asking for one or more offers (Russian or English, often informal, sometimes with emoji flags, "•" or "/" separators, or just plain prose, sometimes several distinct asks in one message).

Return ONLY a JSON object with these keys:

- "items": an array, one entry per DISTINCT specific ask — i.e. whenever a brand name and/or a GEO+source+rate combination is named, even if there are several such asks in the same message (e.g. three lines each naming a different brand/GEO/rate is THREE items, not a bundle). Each item is an object with:
  - "geo": ISO-2 country code, uppercase (e.g. "IT"). If a couple of GEOs belong to the very same single ask, join with "/" (e.g. "IT/ES").
  - "brand": the specific casino/brand name for this ask, if named. Null if this particular ask doesn't name one.
  - "traffic_source": the traffic source (e.g. "FB", "Google", "TikTok", "Push"), as written.
  - "game_type": the game type/vertical (e.g. "Slots", "Mix", "Crash", "Casino", "Sports", "Poker"). "Слот"/"Слоты" → "Slots", "Микс" → "Mix", "Краш" → "Crash".
  - "rate_wish": the desired payout/rate for THIS item, as a short phrase (e.g. "до $200", "160€", "265$"). Null if not stated for this item.
  Use an empty array if there is no specific ask at all (e.g. the whole message is only a generic bundle request — see "bundle_geos" below).

- "bundle_geos": ONLY when the partner is asking generically for "whatever you have" / "подборка" across a list of GEOs WITHOUT naming specific brands for each — list the GEOs as comma-separated ISO-2 codes (e.g. "IT, ES, DE"). Null whenever "items" already captures the ask (i.e. don't duplicate GEOs into both). A message can have both if it names some specific brands AND separately asks for a generic bundle in other GEOs — in that case fill both.

- "extra": any overarching note that applies to the whole message and isn't tied to one item — KPI, wagering requirement, urgency, a general remark like "currently very interested in these brands". Short phrase, or null.

Be conservative — only fill what's clearly present, never invent values. Output JSON only, no explanation, no markdown fences.`;

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, has_openai_key: !!OPENAI_API_KEY, model: OPENAI_MODEL });
    }
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY env var" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const text = (body?.text || "").trim();
    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }
    if (text.length > 4000) {
      return res.status(400).json({ error: "Text too long" });
    }

    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text }
        ]
      })
    });

    const data = await completion.json();
    if (!completion.ok) {
      return res.status(502).json({ error: "OpenAI request failed", detail: data?.error?.message });
    }

    const raw = data?.choices?.[0]?.message?.content || "{}";
    let fields;
    try {
      fields = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "Could not parse model output", raw });
    }

    const cleanItem = (it) => ({
      geo: typeof it?.geo === "string" ? it.geo.trim().toUpperCase() : null,
      brand: it?.brand || null,
      traffic_source: it?.traffic_source || null,
      game_type: it?.game_type || null,
      rate_wish: it?.rate_wish || null,
    });
    const items = Array.isArray(fields.items) ? fields.items.map(cleanItem).filter(it => it.geo || it.brand) : [];
    const bundle_geos = typeof fields.bundle_geos === "string" && fields.bundle_geos.trim() ? fields.bundle_geos.trim().toUpperCase() : null;
    const extra = fields.extra || null;

    return res.status(200).json({ ok: true, fields: { items, bundle_geos, extra } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

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
  - "traffic_source": the traffic source, NORMALIZED to its standard industry form regardless of how it was written — "фб"/"фейсбук"/"facebook" → "FB", "гугл"/"google ads" → "Google", "тт"/"тик ток"/"tiktok" → "TikTok", "пуш" → "Push", "инста" → "Instagram", "сео" → "SEO". Keep other sources as their standard short form. Null if not stated.
  - "game_type": the game type/vertical, written out exactly as the type actually named in the text — Slots, Mix and Crash are the most common ("Слот"/"Слоты" → "Slots", "Микс" → "Mix", "Краш" → "Crash"), but this is NOT a fixed list: if the partner names something less common (Cross, Casino, Sports, Poker, Live, Bingo, or anything else), output that vertical as stated — never drop it just because it isn't one of the common three, and never coerce an unusual vertical into one of the common ones.
  - "rate_wish": the rate/price for THIS item, EXACTLY as implied by the text — do not add "до"/"от"/"up to"/"at least" or any other qualifier unless the source text itself actually says that (e.g. "до 200", "минимум 150", "not less than $150"). A bare number like "160€?" is just the rate being asked about — output "160€", not "до 160€". Null if not stated for this item.
  Use an empty array if there is no specific ask at all (e.g. the whole message is only a generic bundle request — see "bundle" below).

- "bundle": ONLY when the partner is asking generically for "whatever you have" / "подборка" across a set of GEOs WITHOUT naming specific brands for each. An object with:
  - "geos": the requested GEOs, SPACE-separated (not comma-separated), e.g. "IT ES DE". If the partner references a named tier/region/bucket you cannot expand into actual country codes (e.g. "тир 1", "топ гео", "как и ранее"), put that reference in as plain text instead of guessing countries — e.g. "тир 1". Never invent or guess which countries a tier/region name means.
  - "traffic_source": the traffic source that applies to the whole bundle ask, NORMALIZED the same way as in "items" (e.g. "фб" → "FB"). Null if not stated.
  - "game_type": the game type/vertical that applies to the whole bundle ask, same rules as above (not limited to Slots/Mix/Crash). Null if not stated.
  - "note": any remark about the bundle itself — e.g. the partner saying they'll consider/negotiate on your proposed rates ("рассмотрим ваши ставки" → "рассмотрим ваши ставки"), it being a "топ"/priority ask, urgency, etc. Null if nothing notable.
  IMPORTANT: once you decide this is a bundle ask, you must still fill traffic_source/game_type/note from the rest of the message even if "geos" could only be captured as an unexpanded tier/region reference — never let an unresolved GEO reference cause you to drop the other fields.
  Set the whole "bundle" object to null whenever "items" already captures the ask (i.e. don't duplicate GEOs into both). A message can have both if it names some specific brands AND separately asks for a generic bundle in other GEOs — in that case fill both "items" and "bundle".

- "extra": any overarching note that applies to the whole message and isn't tied to one item or already captured in "bundle.note" — KPI, wagering requirement, urgency, a general remark like "currently very interested in these brands". Short phrase, or null.

Be conservative about inventing values (never guess a GEO, brand, or rate that isn't there) — but be thorough about capturing everything that IS present, even alongside something you couldn't fully resolve. Output JSON only, no explanation, no markdown fences.`;

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
    const b = fields.bundle;
    const bundle = (b && typeof b === "object" && typeof b.geos === "string" && b.geos.trim())
      ? {
          // normalize whatever separator the model used (comma, slash, extra spaces) to single spaces
          geos: b.geos.trim().toUpperCase().split(/[,\s/]+/).filter(Boolean).join(' '),
          traffic_source: b.traffic_source || null,
          game_type: b.game_type || null,
          note: b.note || null,
        }
      : null;
    const extra = fields.extra || null;

    return res.status(200).json({ ok: true, fields: { items, bundle, extra } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Parses a free-form pasted offer message into structured delivery fields using OpenAI.
// Called from the mobile "Добавить выдачу" quick-add form so a manager can paste a raw
// message from a partner and have GEO/brand/source/rate/capa auto-filled.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const SYSTEM_PROMPT = `You extract structured fields from a raw affiliate-marketing offer message (Russian or English, often informal, sometimes with emoji flags, "•" or "/" separators, or just plain prose).

Return ONLY a JSON object with these keys (use null for anything not present — never guess or invent a value):
- "geo": ISO-2 country code, uppercase (e.g. "IT", "CA"). Infer from a country name, flag emoji, or explicit code.
- "brand": the casino/brand name.
- "traffic_source": the traffic source mentioned (e.g. "FB", "Google", "TikTok", "Push"). Keep it short, as written.
- "game_type": the game type/vertical, written out exactly as named in the text — Slots, Mix and Crash are the most common ("Слот"/"Слоты" → "Slots", "Микс" → "Mix", "Краш" → "Crash"), but this is NOT a fixed list: if something less common is named (Cross, Casino, Sports, Poker, Live, Bingo, or anything else), output that vertical as stated — never drop it just because it isn't one of the common three, and never coerce an unusual vertical into one of the common ones.
- "rate": the payout/rate as a short string exactly as it appears, including currency symbol if present (e.g. "$190", "150 EUR", "200 USD"). Do not do currency conversion.
- "min_deposit": minimum deposit, as a short string with currency if present (e.g. "20 EUR").
- "capa": the cap/capa — a NUMBER only (count of deposits/FTDs), e.g. 20. If it says "20 FTD" or "cap 20" or "капа 20", return 20. Null if absent.
- "kpi": any KPI/wagering requirement text, as written.
- "platform": the platform/software mentioned (e.g. "Soft2Bet", "In-house", "iGate").
- "partner": the partner/company name this offer is FROM, if explicitly named (not who it's being given to).

Be conservative — only fill a field if it is clearly present in the text. Output JSON only, no explanation, no markdown fences.`;

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

    // Normalize: keep only expected keys, coerce capa to a number
    const ALLOWED = ["geo", "brand", "traffic_source", "game_type", "rate", "min_deposit", "capa", "kpi", "platform", "partner"];
    const clean = {};
    for (const k of ALLOWED) {
      let v = fields[k];
      if (v === undefined || v === "" || v === "null") v = null;
      if (k === "capa" && v != null) {
        const n = parseFloat(String(v).replace(/[^\d.]/g, ""));
        v = isNaN(n) ? null : n;
      }
      if (k === "geo" && typeof v === "string") v = v.trim().toUpperCase().slice(0, 2);
      clean[k] = v;
    }

    return res.status(200).json({ ok: true, fields: clean });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

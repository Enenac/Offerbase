// Parses a raw partner message (a request for an offer) into a compact, uniform
// one-line summary for the "notes" ("новый формат") field on the Requests page.
// Called from the mobile "new request" quick-add form.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const SYSTEM_PROMPT = `You extract structured fields from a raw message where an affiliate partner is asking for an offer (Russian or English, often informal, sometimes with emoji flags, "•" or "/" separators, or just plain prose).

Return ONLY a JSON object with these keys (use null for anything not present — never guess or invent a value):
- "geo": ISO-2 country code, uppercase (e.g. "IT", "CA"). If multiple GEOs are requested, join them with "/" (e.g. "IT/ES"). Infer from a country name, flag emoji, or explicit code.
- "traffic_source": the traffic source mentioned (e.g. "FB", "Google", "TikTok", "Push"). Keep it short, as written.
- "game_type": the game type/vertical (e.g. "Slots", "Mix", "Crash", "Casino", "Sports", "Poker"). "Слот"/"Слоты" → "Slots", "Микс" → "Mix", "Краш" → "Crash".
- "rate_wish": the desired payout/rate or range, as a short phrase exactly reflecting what was asked, in Russian if the source text is Russian (e.g. "до $200", "от 150 EUR", "150-200 USD"). Null if no rate is mentioned.
- "extra": any other short requirement — KPI, wagering requirement, min deposit expectations, urgency, or other notable ask — as a short phrase. Null if nothing notable beyond the fields above.

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

    const ALLOWED = ["geo", "traffic_source", "game_type", "rate_wish", "extra"];
    const clean = {};
    for (const k of ALLOWED) {
      let v = fields[k];
      if (v === undefined || v === "" || v === "null") v = null;
      if (k === "geo" && typeof v === "string") v = v.trim().toUpperCase();
      clean[k] = v;
    }

    return res.status(200).json({ ok: true, fields: clean });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

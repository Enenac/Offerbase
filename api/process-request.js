// Processes ONE raw partner request with a user-supplied prompt (edited in the app: Запросы → «ИИ-обработка»)
// and returns plain text — the structured "новый формат" line(s) the prompt asks for.
// The client calls this once per request and writes the result into requests.notes.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL_REQUESTS || process.env.OPENAI_MODEL || "gpt-4o-mini";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return res.status(200).json({ ok: true, has_openai_key: !!OPENAI_API_KEY, model: OPENAI_MODEL });
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY env var" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const prompt = (body?.prompt || "").trim();
    const text = (body?.text || "").trim();
    if (!prompt) return res.status(400).json({ error: "Пустой промпт" });
    if (!text) return res.status(400).json({ error: "Пустой текст запроса" });
    if (prompt.length > 20000) return res.status(400).json({ error: "Промпт слишком длинный" });
    if (text.length > 6000) return res.status(400).json({ error: "Текст запроса слишком длинный" });

    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: prompt + "\n\nОтвечай ТОЛЬКО готовым результатом в запрошенном формате — без пояснений, без markdown-блоков и кавычек вокруг ответа." },
          { role: "user", content: text }
        ]
      })
    });
    const data = await completion.json();
    if (!completion.ok) return res.status(502).json({ error: "OpenAI request failed", detail: data?.error?.message });

    let result = (data?.choices?.[0]?.message?.content || "").trim();
    result = result.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

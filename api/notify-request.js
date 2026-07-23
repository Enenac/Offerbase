// Posts newly created requests into a Telegram topic.
// Triggered by a Supabase Database Webhook on INSERT into public.requests.
// Secrets live in Vercel env vars — never hardcode them here.
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID || "-1003675580116";
// thread (topic) id of the requests branch in the work group
const TG_REQUESTS_THREAD_ID = process.env.TG_REQUESTS_THREAD_ID;
// shared secret so only Supabase can trigger this endpoint
const HOOK_SECRET = process.env.HOOK_SECRET;

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildMessage(row) {
  const partner = escapeHtml(row.title) || "без названия";
  const raw = (row.raw_text || "").trim();
  // Telegram caps messages at 4096 chars; leave room for the header
  const body = raw.length > 3500 ? raw.slice(0, 3500) + "\n…(обрезано)" : raw;

  let text = `📥 <b>Новый запрос</b>\n`;
  text += `<b>Партнёр:</b> ${partner}\n`;
  if (body) text += `\n${escapeHtml(body)}`;
  return text;
}

async function sendTelegram(text) {
  const payload = {
    chat_id: TG_CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  // only set the thread when configured, otherwise the message goes to General
  if (TG_REQUESTS_THREAD_ID) payload.message_thread_id = Number(TG_REQUESTS_THREAD_ID);

  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return res.json();
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      // quick config check: open this URL in a browser
      return res.status(200).json({
        ok: true,
        has_tg_token: !!TG_TOKEN,
        thread_configured: !!TG_REQUESTS_THREAD_ID,
        thread_id: TG_REQUESTS_THREAD_ID || null,
        chat_id: TG_CHAT_ID,
        secret_required: !!HOOK_SECRET
      });
    }
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!TG_TOKEN) {
      return res.status(500).json({ error: "Missing env vars", has_tg_token: false });
    }
    // reject anything that isn't the configured webhook
    if (HOOK_SECRET) {
      const provided = req.headers["x-hook-secret"] || req.headers["x-webhook-secret"];
      if (provided !== HOOK_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    // Supabase webhook shape: { type: 'INSERT', table, record, old_record }
    const row = body?.record || body;
    if (!row || !row.id) {
      return res.status(400).json({ error: "No record in payload" });
    }
    if (body?.type && body.type !== "INSERT") {
      return res.status(200).json({ ok: true, skipped: body.type });
    }

    const result = await sendTelegram(buildMessage(row));
    if (!result.ok) {
      return res.status(502).json({ error: "Telegram rejected", detail: result.description });
    }
    return res.status(200).json({
      ok: true,
      message_id: result.result?.message_id,
      thread_configured: !!TG_REQUESTS_THREAD_ID,
      thread_used: TG_REQUESTS_THREAD_ID ? Number(TG_REQUESTS_THREAD_ID) : null
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

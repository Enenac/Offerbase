// Sends a DM when a new delivery is created.
// Triggered by a Supabase Database Webhook on INSERT into public.deliveries.
// Secrets live in Vercel env vars — never hardcode them here.
const TG_TOKEN = process.env.TG_TOKEN;
// personal chat id (owner's DM with the bot), not the group id
const TG_OWNER_CHAT_ID = process.env.TG_OWNER_CHAT_ID || "1309935213";
// shared secret so only Supabase can trigger this endpoint
const HOOK_SECRET = process.env.HOOK_SECRET;

const STATUS_LABEL = {
  waiting_link: "🔗 Ожидаем ссылку",
  waiting_launch: "⏳ Ожидаем запуска",
  launched: "✅ Запущен",
  problem: "⚠️ Проблема",
  stopped: "🛑 На стопе"
};
const CUR_SYM = { EUR: "€", USD: "$" };

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildMessage(row) {
  const raw = (row.notes || row.brand || "").trim();
  const offerText = raw.length > 3000 ? raw.slice(0, 3000) + "\n…(обрезано)" : raw;

  const looksLikeQuickAdd = !row.partner && (row.capa == null || Number(row.capa) === 0) && row.amount_src == null;

  let text = `🔗 <b>Новая выдача</b>\n`;
  if (looksLikeQuickAdd) text += `📱 добавлено с телефона — нужно доработать детали\n`;
  if (row.status && STATUS_LABEL[row.status]) text += `${STATUS_LABEL[row.status]}\n`;
  if (offerText) text += `\n${escapeHtml(offerText)}`;
  if (row.partner) text += `\n\nКому: ${escapeHtml(row.partner)}`;
  if (row.created_by) text += `\nИсточник: ${escapeHtml(row.created_by)}`;
  if (row.amount_src != null) {
    const src = `${CUR_SYM[row.amount_src_cur] || ""}${row.amount_src}`;
    const out = row.amount_out != null ? `${CUR_SYM[row.amount_out_cur] || ""}${row.amount_out}` : "—";
    text += `\nСуммы: ${src} → ${out}`;
  }
  if (row.capa != null && Number(row.capa) > 0) text += `\nКапа: ${row.capa}`;
  return text;
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_OWNER_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  });
  return res.json();
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      // quick config check in a browser
      return res.status(200).json({
        ok: true,
        has_tg_token: !!TG_TOKEN,
        owner_chat_id: TG_OWNER_CHAT_ID,
        secret_required: !!HOOK_SECRET
      });
    }
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!TG_TOKEN) {
      return res.status(500).json({ error: "Missing env vars", has_tg_token: false });
    }
    if (HOOK_SECRET) {
      const provided = req.headers["x-hook-secret"] || req.headers["x-webhook-secret"];
      if (provided !== HOOK_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
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
    return res.status(200).json({ ok: true, message_id: result.result?.message_id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

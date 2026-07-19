const SUPABASE_URL = "https://qwkcoerixspaojyzesxa.supabase.co";
// service_role key — bypasses RLS. Never hardcode: set in Vercel env vars.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = "-1003675580116";
const TG_THREAD_ID = 861;

async function fetchSupabase(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": options.prefer || "return=minimal",
      ...options.headers
    }
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  return res.json().catch(() => null);
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_CHAT_ID,
      message_thread_id: TG_THREAD_ID,
      text,
      parse_mode: "HTML"
    })
  });
  return res.json();
}

export default async function handler(req, res) {
  try {
    if (!SUPABASE_KEY || !TG_TOKEN) {
      return res.status(500).json({
        error: "Missing env vars",
        has_supabase_key: !!SUPABASE_KEY,
        has_tg_token: !!TG_TOKEN
      });
    }
    const now = new Date().toISOString();

    // Get pending reminders
    const deliveries = await fetchSupabase(
      `deliveries?remind_at=lte.${now}&remind_sent=eq.false&status=eq.waiting_launch&select=*`,
      { prefer: "return=representation" }
    );

    if (!deliveries || deliveries.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    for (const d of deliveries) {
      const project = d.project === 'phantom' ? '👻 Phantom Partners' : '🌪 Smerch-Traffic';
      const text = `⏰ <b>Напоминание о выдаче</b>\n\n` +
        `${project}\n` +
        `👤 <b>Партнёр:</b> ${d.partner || '—'}\n` +
        `🎰 <b>Бренд:</b> ${d.brand || '—'}\n` +
        `🌍 <b>GEO:</b> ${d.geo || '—'}\n` +
        `📊 <b>Источник:</b> ${d.traffic_source || '—'}\n` +
        `💰 <b>Ставка:</b> ${d.rate || '—'}\n` +
        (d.notes ? `📝 <b>Заметки:</b> ${d.notes}\n` : '') +
        `\n⚡️ Пингани партнёра — запустил ли оффер?`;

      await sendTelegram(text);

      // Mark as sent
      await fetchSupabase(`deliveries?id=eq.${d.id}`, {
        method: "PATCH",
        body: JSON.stringify({ remind_sent: true }),
        headers: { "Prefer": "return=minimal" }
      });

      sent++;
    }

    return res.status(200).json({ ok: true, sent });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}

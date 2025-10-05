// api/new_request.js
export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Use POST method" });

  const { udid, pin, type } = req.body || {};

  if (!udid && !pin)
    return res.status(400).json({ error: "Missing udid or pin" });

  const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
  const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

  const text = `
🆕 Yêu cầu mới:
🔑 UDID/PIN: ${udid || pin}
📦 Loại: ${type || "Không rõ"}
🕒 ${new Date().toLocaleString("vi-VN")}
  `;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text,
      }),
    });

    // Lưu lại yêu cầu mới nhất vào file "latest.json" trên GitHub
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO = process.env.REPO;
    const latest = {
      udid: udid || pin,
      type: type || "unknown",
      time: new Date().toISOString(),
    };

    const content = Buffer.from(JSON.stringify(latest, null, 2)).toString("base64");

    await fetch(`https://api.github.com/repos/${REPO}/contents/results/latest.json`, {
      method: "PUT",
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "update latest request",
        content,
      }),
    });

    res.status(200).json({ ok: true, message: "Đã gửi yêu cầu tới bot Telegram" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

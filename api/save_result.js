// api/save_result.js
export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Use POST method" });

  const { udid, result } = req.body || {};
  if (!udid || !result)
    return res.status(400).json({ error: "Missing udid or result" });

  try {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO = process.env.REPO;

    const content = Buffer.from(JSON.stringify(result, null, 2)).toString("base64");

    const response = await fetch(
      `https://api.github.com/repos/${REPO}/contents/results/${udid}.json`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `update result for ${udid}`,
          content,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: errText });
    }

    res.status(200).json({ ok: true, saved: `results/${udid}.json` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

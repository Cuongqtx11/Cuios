// api/latest_request.js
export default async function handler(req, res) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Use GET method" });

  const REPO = process.env.REPO;
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  const response = await fetch(
    `https://api.github.com/repos/${REPO}/contents/results/latest.json`,
    {
      headers: { Authorization: `token ${GITHUB_TOKEN}` },
    }
  );

  if (!response.ok)
    return res.status(404).json({ error: "No latest request found" });

  const data = await response.json();
  const decoded = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));

  res.status(200).json(decoded);
}

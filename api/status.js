const jobs = require('./check').jobs;

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Only GET allowed' });

  const { jobId } = req.query;
  if (!jobId || !jobs[jobId]) return res.status(400).json({ ok: false, error: 'Invalid jobId' });

  res.json({ ok: true, status: jobs[jobId].status, result: jobs[jobId].result });
};

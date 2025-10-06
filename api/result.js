const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { jobId } = req.query;
  if (!jobId) return res.status(400).json({ ok:false, error:'Missing jobId' });

  const resultJson = await redis.get(`result:${jobId}`);
  if (!resultJson) return res.json({ ok:true, status:'pending', result:null });

  const result = JSON.parse(resultJson);
  res.json({ ok:true, status:'done', result });
};

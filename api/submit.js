const formidable = require('formidable');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Only POST allowed' });

  const form = formidable({ multiples: false, keepExtensions: true });
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ ok:false, error: err.message });
    if (!files.ZipFile) return res.status(400).json({ ok:false, error:'Missing ZipFile' });

    const jobId = uuidv4();
    const uploadDir = path.join(__dirname, 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, files.ZipFile.originalFilename);
    fs.renameSync(files.ZipFile.filepath, filePath);

    // Push job vào Redis queue
    const jobData = JSON.stringify({ jobId, zipPath: filePath, password: fields.P12PassWordZip, status:'pending', result:null });
    await redis.lpush('p12_queue', jobData);

    res.json({ ok:true, jobId });
  });
};

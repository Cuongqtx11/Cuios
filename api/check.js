// api/check.js
const fs = require('fs');
const FormData = require('form-data');
const formidable = require('formidable');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const TARGET_URL = 'https://check.p12apple.com/';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  const form = formidable({ multiples: false });
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Form parse error', detail: err.message });
    if (!files.ZipFile) return res.status(400).json({ error: 'Missing ZipFile' });

    try {
      const fd = new FormData();
      fd.append('ZipFile', fs.createReadStream(files.ZipFile.filepath), {
        filename: files.ZipFile.originalFilename,
      });
      fd.append('P12PassWordZip', fields.P12PassWordZip || '');
      fd.append('inputMethod', 'zip_upload');

      const resp = await fetch(TARGET_URL, {
        method: 'POST',
        body: fd,
        headers: fd.getHeaders(),
      });

      const html = await resp.text();
      const $ = cheerio.load(html);

      const result = {};
      $('li, p, span, div').each((_, el) => {
        const t = $(el).text().trim();
        if (/Cert(Name)?|Tên chứng chỉ/i.test(t)) result.certName = t.split(':')[1]?.trim();
        if (/Effective|Ngày bắt đầu/i.test(t)) result.effectiveDate = t.split(':')[1]?.trim();
        if (/Expiration|Ngày hết hạn/i.test(t)) result.expirationDate = t.split(':')[1]?.trim();
        if (/Status|Trạng thái/i.test(t)) result.status = t.split(':')[1]?.trim();
      });

      res.json({ ok: true, ...result, raw: html.slice(0, 500) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message });
    } finally {
      try {
        if (files.ZipFile && fs.existsSync(files.ZipFile.filepath))
          fs.unlinkSync(files.ZipFile.filepath);
      } catch {}
    }
  });
};

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

  const form = formidable({ multiples: false, keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Form parse error', detail: err.message });
    if (!files.ZipFile) return res.status(400).json({ error: 'Missing ZipFile' });

    const filePath = files.ZipFile[0]?.filepath || files.ZipFile.filepath;
    const fileName = files.ZipFile[0]?.originalFilename || files.ZipFile.originalFilename;

    try {
      const fd = new FormData();
      fd.append('ZipFile', fs.createReadStream(filePath), { filename: fileName });
      fd.append('P12PassWordZip', fields.P12PassWordZip?.[0] || fields.P12PassWordZip || '');
      fd.append('inputMethod', 'zip_upload');

      const resp = await fetch(TARGET_URL, {
        method: 'POST',
        body: fd,
        headers: fd.getHeaders(),
      });

      const html = await resp.text();
      const $ = cheerio.load(html);
      const result = {};

      $('li').each((_, el) => {
        const text = $(el).text().trim();
        if (/CertName/i.test(text)) result.certName = text.split(':')[1]?.trim();
        if (/Effective Date/i.test(text)) result.effectiveDate = text.split(':')[1]?.trim();
        if (/Expiration Date/i.test(text)) result.expirationDate = text.split(':')[1]?.trim();
        if (/Certificate Status/i.test(text)) result.status = text.split(':')[1]?.trim();
      });

      // Nếu không có <li> thì fallback
      if (!result.certName && html.includes('CertName')) {
        const match = html.match(/CertName[^<]*:(.*?)<br>/i);
        if (match) result.certName = match[1].trim();
      }

      res.json({ ok: true, ...result });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message });
    } finally {
      try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    }
  });
};

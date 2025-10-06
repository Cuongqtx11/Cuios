const fs = require('fs');
const FormData = require('form-data');
const formidable = require('formidable');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const TARGET_URL = 'https://check.p12apple.com/';
const TIMEOUT_MS = 15000;

// Hàm fetch có timeout
async function fetchWithTimeout(url, options = {}, timeout = TIMEOUT_MS) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeout)
    ),
  ]);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, error: 'Only POST allowed' });

  const form = formidable({ multiples: false, keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err)
      return res.status(500).json({ ok: false, error: 'Form parse error' });
    if (!files.ZipFile)
      return res.status(400).json({ ok: false, error: 'Missing ZipFile' });

    const filePath = files.ZipFile.filepath;

    try {
      const fd = new FormData();
      fd.append('ZipFile', fs.createReadStream(filePath), {
        filename: files.ZipFile.originalFilename || 'upload.zip',
      });
      fd.append('P12PassWordZip', fields.P12PassWordZip || '');
      fd.append('inputMethod', 'zip_upload');
      fd.append('_nocache', Date.now().toString());

      // gửi request
      const resp = await fetchWithTimeout(`${TARGET_URL}?_=${Date.now()}`, {
        method: 'POST',
        body: fd,
        headers: {
          ...fd.getHeaders(),
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
          Expires: '0',
        },
      });

      const html = await resp.text();
      const $ = cheerio.load(html, { decodeEntities: true });
      const result = {};

      // lấy text trong tất cả li/p/div
      const lines = [];
      $('li, p, div, td, span').each((_, el) => {
        const text = $(el).text().trim();
        if (text) lines.push(text);
      });

      for (const text of lines) {
        const clean = text.replace(/\s+/g, ' ').trim();
        if (/certname/i.test(clean))
          result.certName = clean.split(':').slice(1).join(':').trim();
        if (/effective date/i.test(clean))
          result.effectiveDate = clean.split(':').slice(1).join(':').trim();
        if (/expiration date/i.test(clean))
          result.expirationDate = clean.split(':').slice(1).join(':').trim();
        if (/certificate status/i.test(clean)) {
          result.status = clean.split(':').slice(1).join(':').trim();
          // chuẩn hóa emoji
          result.status = result.status
            .replace('🟢', 'Good')
            .replace('🔴', 'Revoked')
            .replace('🟡', 'Expired')
            .trim();
        }
      }

      if (!result.status) {
        const bodyText = $('body').text().replace(/\s+/g, ' ');
        const m = bodyText.match(/Status\s*:\s*([A-Za-z🟢🔴🟡 ]+)/i);
        if (m) {
          result.status = m[1]
            .replace('🟢', 'Good')
            .replace('🔴', 'Revoked')
            .replace('🟡', 'Expired')
            .trim();
        }
      }

      if (!Object.keys(result).length)
        throw new Error('Không lấy được dữ liệu — HTML không khớp.');

      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    } finally {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    }
  });
};

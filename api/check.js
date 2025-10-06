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
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Only POST allowed' });

  const form = formidable({ multiples: false, keepExtensions: false });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ ok: false, error: 'Form parse error', detail: err.message });
    if (!files.ZipFile) return res.status(400).json({ ok: false, error: 'Missing ZipFile' });

    const filePath = files.ZipFile.filepath;
    try {
      const fd = new FormData();
      fd.append('ZipFile', fs.createReadStream(filePath), {
        filename: files.ZipFile.originalFilename || `upload-${Date.now()}.zip`,
      });
      fd.append('P12PassWordZip', fields.P12PassWordZip || '');
      fd.append('inputMethod', 'zip_upload');
      fd.append('_nocache', Date.now().toString());

      const resp = await fetch(`${TARGET_URL}?_=${Date.now()}`, {
        method: 'POST',
        body: fd,
        headers: {
          ...fd.getHeaders(),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Connection': 'close',
        },
      });

      const html = await resp.text();

      if (!html || html.length < 100) {
        throw new Error('Trang đích phản hồi rỗng hoặc không hợp lệ');
      }

      const $ = cheerio.load(html);
      const result = {};

      $('li').each((_, el) => {
        const text = $(el).text().trim();
        if (text.includes('CertName')) result.certName = text.split(':')[1]?.trim();
        if (text.includes('Effective Date')) result.effectiveDate = text.split(':')[1]?.trim();
        if (text.includes('Expiration Date')) result.expirationDate = text.split(':')[1]?.trim();
        if (text.includes('Certificate Status')) result.status = text.split(':')[1]?.trim();
      });

      res.json({ ok: true, ...result });
    } catch (error) {
      console.error('❌ Lỗi khi check chứng chỉ:', error);
      res.status(500).json({ ok: false, error: error.message });
    } finally {
      try {
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (cleanupErr) {
        console.warn('⚠️ Không thể xoá file tạm:', cleanupErr.message);
      }
    }
  });
};

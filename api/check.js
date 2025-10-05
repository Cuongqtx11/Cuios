// api/check.js
const fs = require('fs');
const FormData = require('form-data');
const formidable = require('formidable');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const TARGET_URL = 'https://check.p12apple.com/'; // form action thật

module.exports = async (req, res) => {
  // Cho phép CORS từ mọi nguồn (để test dễ hơn)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  const form = new formidable.IncomingForm({ multiples: false });
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Form parse error', detail: err.message });
    if (!files.ZipFile) return res.status(400).json({ error: 'Missing ZipFile' });

    try {
      // Tạo form gửi lên site check.p12apple.com
      const fd = new FormData();
      fd.append('ZipFile', fs.createReadStream(files.ZipFile.path), { filename: files.ZipFile.name });
      fd.append('P12PassWordZip', fields.P12PassWordZip || '');
      fd.append('inputMethod', 'zip_upload');

      // Gửi POST thật đến trang check
      const resp = await fetch(TARGET_URL, {
        method: 'POST',
        body: fd,
        headers: fd.getHeaders(),
      });

      const html = await resp.text();

      // Dùng cheerio để bóc dữ liệu
      const $ = cheerio.load(html);
      const result = {};

      $('li').each((_, el) => {
        const text = $(el).text().trim();
        if (text.includes('CertName')) result.certName = text.split(':')[1]?.trim();
        if (text.includes('Effective Date')) result.effectiveDate = text.split(':')[1]?.trim();
        if (text.includes('Expiration Date')) result.expirationDate = text.split(':')[1]?.trim();
        if (text.includes('Certificate Status')) result.status = text.split(':')[1]?.trim();
      });

      // Trả về JSON gọn gàng
      return res.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: error.message });
    } finally {
      if (files.ZipFile && fs.existsSync(files.ZipFile.path)) fs.unlinkSync(files.ZipFile.path);
    }
  });
};

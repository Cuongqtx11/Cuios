// api/check.js
const fs = require('fs');
const FormData = require('form-data');
const formidable = require('formidable');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const TARGET_URL = 'https://check.p12apple.com/';

module.exports = async (req, res) => {
  // CORS để front-end có thể gọi từ cùng domain / khác domain khi cần
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  const form = formidable({ multiples: false });
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Form parse error', detail: err.message });

    const upload = files.ZipFile || files.P12File || files.file || files.MobileProvisionFile;
    if (!upload) return res.status(400).json({ error: 'Missing ZipFile (upload a .zip)' });

    try {
      // Build post form that the external site expects
      const postForm = new FormData();
      postForm.append('ZipFile', fs.createReadStream(upload.filepath), {
        filename: upload.originalFilename || upload.newFilename || 'upload.zip'
      });
      postForm.append('P12PassWordZip', fields.P12PassWordZip || '');
      postForm.append('inputMethod', 'zip_upload');

      // POST to external site
      const forwardResp = await fetch(TARGET_URL, {
        method: 'POST',
        body: postForm,
        headers: postForm.getHeaders(),
        redirect: 'follow'
      });

      const respHtml = await forwardResp.text();
      const $ = cheerio.load(respHtml);

      // function extracts "label: rest-of-line" preserving extra colons
      const getValueFromText = (label, text) => {
        const re = new RegExp(label + '\\s*:\\s*(.*)', 'i');
        const m = text.match(re);
        return m ? m[1].trim() : null;
      };

      // search typical containers
      let certName = null, expirationDateRaw = null, statusRaw = null, effectiveDateRaw = null;

      // try to capture from obvious tags
      $('li, p, div').each((i, el) => {
        const t = $(el).text().trim();
        if (!t) return;
        if (!certName && /CertName/i.test(t)) certName = getValueFromText('CertName', t) || getValueFromText('Certificate Name', t);
        if (!effectiveDateRaw && /Effective Date/i.test(t)) effectiveDateRaw = getValueFromText('Effective Date', t);
        if (!expirationDateRaw && /Expiration Date|Expiry Date/i.test(t)) expirationDateRaw = getValueFromText('Expiration Date', t) || getValueFromText('Expiry Date', t);
        if (!statusRaw && /Certificate Status|Status/i.test(t)) statusRaw = getValueFromText('Certificate Status', t) || getValueFromText('Status', t);
      });

      // fallback: search whole page text by label
      const pageText = $.root().text();
      if (!certName) certName = getValueFromText('CertName', pageText) || getValueFromText('Certificate Name', pageText);
      if (!effectiveDateRaw) effectiveDateRaw = getValueFromText('Effective Date', pageText);
      if (!expirationDateRaw) expirationDateRaw = getValueFromText('Expiration Date', pageText) || getValueFromText('Expiry Date', pageText);
      if (!statusRaw) statusRaw = getValueFromText('Certificate Status', pageText) || getValueFromText('Status', pageText);

      // Normalize date (only day/month/year)
      const parseDate = (s) => {
        if (!s) return null;
        // remove timezone text like "UTC" for Date parsing convenience
        const trimmed = s.replace(/UTC/i, '').trim();
        // Try to parse with Date
        const d = new Date(trimmed);
        if (isNaN(d.getTime())) {
          // fallback: try extracting yyyy-mm-dd or dd/mm/yyyy
          const mIso = trimmed.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (mIso) return new Date(`${mIso[1]}-${mIso[2]}-${mIso[3]}T00:00:00Z`);
          const mDMY = trimmed.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
          if (mDMY) return new Date(`${mDMY[3]}-${mDMY[2].padStart(2,'0')}-${mDMY[1].padStart(2,'0')}T00:00:00Z`);
          return null;
        }
        return d;
      };

      const expDateObj = parseDate(expirationDateRaw);
      const effDateObj = parseDate(effectiveDateRaw);

      // format date as DD/MM/YYYY
      const formatDMY = (d) => {
        if (!d) return null;
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const yyyy = d.getUTCFullYear();
        return `${dd}/${mm}/${yyyy}`;
      };

      // compute days remaining (difference between expiry date at 00:00 UTC and now)
      const daysRemaining = (() => {
        if (!expDateObj) return null;
        const now = new Date();
        // use UTC midnight for consistent day counting
        const expMid = Date.UTC(expDateObj.getUTCFullYear(), expDateObj.getUTCMonth(), expDateObj.getUTCDate());
        const nowMid = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        const diff = expMid - nowMid;
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
      })();

      // Determine status text normalized
      let status = statusRaw || '';
      // Some pages include emoji circle, preserve if present. But we also convert to readable VN text
      let statusLabel = status;
      if (/revok/i.test(status)) statusLabel = '🔴 Revoked';
      else if (/active|valid|hoạt động|ok/i.test(status) || status.trim() === '') statusLabel = statusLabel || '🟢 Hoạt động';

      // Fixed "Loại" as requested
      const loai = 'Distribution có hỗ trợ App Group';

      const result = {
        ok: true,
        certName: certName || null,
        expirationDateRaw: expirationDateRaw || null,
        expirationDate: formatDMY(expDateObj) || null,
        effectiveDateRaw: effectiveDateRaw || null,
        effectiveDate: formatDMY(effDateObj) || null,
        statusRaw: statusRaw || null,
        status: statusLabel,
        daysRemaining: daysRemaining,
        loai
      };

      // cleanup uploaded temp
      try {
        if (upload && upload.filepath && fs.existsSync(upload.filepath)) fs.unlinkSync(upload.filepath);
      } catch (e) {}

      return res.status(200).json(result);
    } catch (e) {
      // cleanup uploaded temp
      try { if (upload && upload.filepath && fs.existsSync(upload.filepath)) fs.unlinkSync(upload.filepath); } catch(e){}
      console.error('error in proxy', e);
      return res.status(500).json({ error: 'Internal error', detail: String(e) });
    }
  });
};

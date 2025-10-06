const fs = require('fs');
const FormData = require('form-data');
const formidable = require('formidable');
const fetch = require('node-fetch');

const TARGET_URL = 'https://check.p12apple.com/';
const TIMEOUT_MS = 15000; // tối đa 15 giây / request

// Hàm fetch có timeout
async function fetchWithTimeout(url, options = {}, timeout = TIMEOUT_MS) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeout)
    ),
  ]);
}

// Hàng đợi để tránh race-condition
let activeChecks = 0;
const MAX_PARALLEL = 2; // chỉ cho phép 2 check song song

async function waitForSlot() {
  while (activeChecks >= MAX_PARALLEL) {
    await new Promise((r) => setTimeout(r, 100)); // chờ 100ms
  }
  activeChecks++;
}

function releaseSlot() {
  activeChecks = Math.max(0, activeChecks - 1);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, error: 'Only POST allowed' });

  const form = formidable({ multiples: false });

  form.parse(req, async (err, fields, files) => {
    if (err)
      return res
        .status(500)
        .json({ ok: false, error: 'Form parse error', detail: err.message });
    if (!files.ZipFile)
      return res.status(400).json({ ok: false, error: 'Missing ZipFile' });

    const filePath = files.ZipFile.filepath;
    await waitForSlot(); // đảm bảo slot rảnh

    try {
      const fd = new FormData();
      fd.append('ZipFile', fs.createReadStream(filePath), {
        filename: files.ZipFile.originalFilename || `upload-${Date.now()}.zip`,
      });
      fd.append('P12PassWordZip', fields.P12PassWordZip || '');
      fd.append('inputMethod', 'zip_upload');
      fd.append('_nocache', Date.now().toString());

      const resp = await fetchWithTimeout(`${TARGET_URL}?_=${Date.now()}`, {
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

      // Dùng regex thay cheerio để tăng tốc
      const getVal = (label) => {
        const regex = new RegExp(`${label}\\s*:\\s*([^<\\n]+)`, 'i');
        const match = html.match(regex);
        return match ? match[1].trim() : '-';
      };

      const result = {
        certName: getVal('CertName'),
        effectiveDate: getVal('Effective Date'),
        expirationDate: getVal('Expiration Date'),
        status: getVal('Certificate Status'),
      };

      res.json({ ok: true, ...result });
    } catch (error) {
      console.error('❌ Lỗi khi check:', error.message);
      res.status(500).json({ ok: false, error: error.message });
    } finally {
      releaseSlot();
      try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    }
  });
};

const fs = require("fs");
const FormData = require("form-data");
const formidable = require("formidable");
const fetch = require("node-fetch");
const cheerio = require("cheerio");

const TARGET_URL = "https://check.p12apple.com/";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Only POST allowed" });

  const form = formidable({ multiples: false, keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err)
      return res.status(500).json({ error: "Form parse error", detail: err.message });
    if (!files.ZipFile)
      return res.status(400).json({ error: "Missing ZipFile" });

    const fileObj = Array.isArray(files.ZipFile)
      ? files.ZipFile[0]
      : files.ZipFile;
    const filePath = fileObj.filepath;
    const fileName = fileObj.originalFilename;

    try {
      const fd = new FormData();
      fd.append("ZipFile", fs.createReadStream(filePath), { filename: fileName });
      fd.append("P12PassWordZip", fields.P12PassWordZip || "");
      fd.append("inputMethod", "zip_upload");

      const resp = await fetch(TARGET_URL, {
        method: "POST",
        body: fd,
        headers: fd.getHeaders(),
      });

      const html = await resp.text();
      const $ = cheerio.load(html);
      const result = {};

      // --- đọc tất cả text từ trang ---
      const allText = $("body").text().replace(/\s+/g, " ").trim();

      // --- lọc dữ liệu ---
      const certMatch = allText.match(/CertName[^:]*:\s*([^\n]+)/i);
      const effMatch = allText.match(/Effective Date[^:]*:\s*([^\n]+)/i);
      const expMatch = allText.match(/Expiration Date[^:]*:\s*([^\n]+)/i);
      const statMatch = allText.match(/(Certificate Status|Status)[^:]*:\s*([^\n]+)/i);

      result.certName = certMatch ? certMatch[1].trim() : null;
      result.effectiveDate = effMatch ? effMatch[1].trim() : null;
      result.expirationDate = expMatch ? expMatch[1].trim() : null;
      result.status = statMatch ? statMatch[2].trim() : null;

      // --- fallback nếu html khác cấu trúc ---
      if (!result.status) {
        if (/revoked/i.test(allText)) result.status = "Revoked";
        else if (/valid/i.test(allText)) result.status = "Valid";
        else if (/expire/i.test(allText)) result.status = "Expired";
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

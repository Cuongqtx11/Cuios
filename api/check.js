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

  const form = formidable({ multiples: false });
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!files.ZipFile)
      return res.status(400).json({ error: "Thiếu file ZipFile" });

    try {
      const fd = new FormData();
      fd.append("ZipFile", fs.createReadStream(files.ZipFile.filepath), {
        filename: files.ZipFile.originalFilename,
      });
      fd.append("P12PassWordZip", fields.P12PassWordZip || "");
      fd.append("inputMethod", "zip_upload");

      const resp = await fetch(TARGET_URL, {
        method: "POST",
        body: fd,
        headers: fd.getHeaders(),
      });
      const html = await resp.text();
      const $ = cheerio.load(html);
      const plain = $("body").text().trim();

      // --- Trích dữ liệu
      let certName = $("li:contains('CertName')").text().split(":")[1]?.trim();
      let effectiveDate = $("li:contains('Effective Date')")
        .text()
        .split(":")[1]?.trim();
      let expirationDate = $("li:contains('Expiration Date')")
        .text()
        .split(":")[1]?.trim();
      let status = $("li:contains('Certificate Status')")
        .text()
        .split(":")[1]?.trim();

      // fallback nếu không tìm thấy trong <li>
      const low = plain.toLowerCase();
      if (!status) {
        if (low.includes("revok")) status = "Đã thu hồi";
        else if (low.includes("expir")) status = "Đã hết hạn";
        else if (low.includes("valid") || low.includes("good"))
          status = "Hoạt động";
        else status = "Không xác định";
      }

      if (!certName && low.includes("iphone distribution"))
        certName = "iPhone Distribution";

      res.json({
        ok: true,
        certName,
        effectiveDate,
        expirationDate,
        status,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      try {
        if (files.ZipFile && fs.existsSync(files.ZipFile.filepath))
          fs.unlinkSync(files.ZipFile.filepath);
      } catch {}
    }
  });
};

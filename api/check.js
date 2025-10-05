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
      // Gửi request lên check.p12apple.com
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

      // Gom tất cả text từ toàn trang
      let text = $("body").text().replace(/\s+/g, " ").trim();

      // Trường hợp trang có JSON ẩn (nếu có)
      const jsonMatch = html.match(/\{[^{}]*(CertName|Expiration Date)[^{}]*\}/i);
      if (jsonMatch) text += " " + jsonMatch[0];

      // Chuẩn hóa chữ
      const low = text.toLowerCase();

      // Regex tìm các trường chính
      const cert = text.match(/CertName[^:]*:\s*([^\n<]+)/i);
      const start = text.match(/Effective[^:]*:\s*([^\n<]+)/i);
      const exp = text.match(/Expiration[^:]*:\s*([^\n<]+)/i);
      const stat =
        text.match(/Status[^:]*:\s*([^\n<]+)/i) ||
        text.match(/Certificate Status[^:]*:\s*([^\n<]+)/i);

      // Mapping trạng thái
      let statusRaw =
        stat?.[1] ||
        (/revok/i.test(low)
          ? "Revoked"
          : /expire/i.test(low)
          ? "Expired"
          : /valid|good|active/i.test(low)
          ? "Valid"
          : "Unknown");

      res.json({
        ok: true,
        certName: cert ? cert[1].trim() : null,
        effectiveDate: start ? start[1].trim() : null,
        expirationDate: exp ? exp[1].trim() : null,
        status: statusRaw,
      });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: error.message });
    } finally {
      try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    }
  });
};

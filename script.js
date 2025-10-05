const API_STATUS = "https://cuios.shop/api/status";
const API_GETCERT = "https://cuios.shop/api/getcert";
const CHECK_URL = "https://check.p12apple.com";

async function checkOrder() {
  const udid = document.getElementById("udid").value.trim();
  const zipFile = document.getElementById("zipFile").files[0];
  const result = document.getElementById("result");
  result.innerHTML = "<p class='loading'>⏳ Đang xử lý, vui lòng đợi...</p>";

  try {
    let res;

    if (zipFile) {
      const formData = new FormData();
      formData.append("ZipFile", zipFile);
      res = await fetch(CHECK_URL, { method: "POST", body: formData });
    } else if (udid) {
      res = await fetch(API_STATUS, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `udid=${encodeURIComponent(udid)}`
      });
    } else {
      alert("⚠️ Vui lòng nhập UDID hoặc chọn file .zip!");
      result.innerHTML = "";
      return;
    }

    if (!res.ok) throw new Error(`Lỗi HTTP ${res.status}`);
    const text = await res.text();

    // Parse JSON nếu có thể
    let output;
    try {
      const json = JSON.parse(text);
      output = JSON.stringify(json, null, 2);
    } catch {
      output = text.replace(/<[^>]*>?/gm, '').slice(0, 1500);
    }

    result.innerHTML = `<p class='success'>✅ Kết quả:</p><pre>${output}</pre>`;
  } catch (err) {
    result.innerHTML = `<p class='error'>❌ Lỗi: ${err.message}</p>`;
  }
}

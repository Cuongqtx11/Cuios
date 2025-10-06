document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = document.getElementById('zip').files[0];
  const pass = document.getElementById('pass').value;
  const resEl = document.getElementById('result');
  resEl.textContent = 'Đang kiểm tra...';

  if (!file) {
    resEl.textContent = 'Vui lòng chọn file ZIP.';
    return;
  }

  try {
    const formData = new FormData();
    formData.append('ZipFile', file);
    formData.append('P12PassWordZip', pass);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch('/api/check?_=' + Date.now(), {
      method: 'POST',
      body: formData,
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await resp.json();

    if (!data.ok) {
      resEl.innerHTML =
        '<div class="revoked">❌ Lỗi: ' +
        (data.error || JSON.stringify(data)) +
        '</div>';
      return;
    }

    const html = `
      <p><b>CertName:</b> ${data.certName || '-'}</p>
      <p><b>Effective Date:</b> ${data.effectiveDate || '-'}</p>
      <p><b>Expiration Date:</b> ${data.expirationDate || '-'}</p>
      <p><b>Status:</b> ${data.status || '-'}</p>
    `;

    if (data.status && data.status.toLowerCase().includes('revoked')) {
      resEl.innerHTML = `<div class="revoked">${html}</div>`;
    } else {
      resEl.innerHTML = `<div class="ok">${html}</div>`;
    }
  } catch (err) {
    resEl.innerHTML =
      '<div class="revoked">⚠️ Lỗi kết nối hoặc server quá tải: ' +
      err.message +
      '</div>';
  }
});

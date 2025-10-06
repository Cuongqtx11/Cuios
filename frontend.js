window.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('form');
  const resEl = document.getElementById('result');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('zip').files[0];
    const pass = document.getElementById('pass').value;
    if (!file) return resEl.textContent = 'Vui lòng chọn file ZIP.';

    resEl.innerHTML = '⏳ Đang kiểm tra...';
    const fd = new FormData();
    fd.append('ZipFile', file);
    fd.append('P12PassWordZip', pass);

    try {
      const resp = await fetch('/api/submit', { method: 'POST', body: fd });
      const data = await resp.json();
      if (!data.ok) return resEl.innerHTML = '❌ Lỗi: ' + (data.error || '');

      const jobId = data.jobId;

      // Poll kết quả
      const poll = setInterval(async () => {
        const r = await fetch(`/api/result?jobId=${jobId}`);
        const resJson = await r.json();
        if (!resJson.ok) return;

        if (resJson.status === 'done') {
          clearInterval(poll);
          const result = resJson.result;
          let color = 'gray';
          if (result.status.toLowerCase() === 'good') color = '#c8f7c5';
          if (result.status.toLowerCase() === 'revoked') color = '#f9c0c0';
          if (result.status.toLowerCase() === 'expired') color = '#f9e79d';

          resEl.innerHTML = `
            <div style="background:${color};padding:10px;border-radius:6px;">
              <p><b>CertName:</b> ${result.certName}</p>
              <p><b>Effective Date:</b> ${result.effectiveDate}</p>
              <p><b>Expiration Date:</b> ${result.expirationDate}</p>
              <p><b>Status:</b> ${result.status}</p>
            </div>
          `;
        }
      }, 1000);
    } catch (err) {
      resEl.innerHTML = '⚠️ Lỗi kết nối: ' + err.message;
    }
  });
});

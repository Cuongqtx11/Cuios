window.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('form');
  const resEl = document.getElementById('result');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const file = document.getElementById('zip').files[0];
    const pass = document.getElementById('pass').value;

    if (!file) return resEl.textContent = 'Vui lòng chọn file ZIP.';
    resEl.innerHTML = '⏳ Đang kiểm tra...';

    const formData = new FormData();
    formData.append('ZipFile', file);
    formData.append('P12PassWordZip', pass);

    try {
      const resp = await fetch('/api/check', { method: 'POST', body: formData });
      const data = await resp.json();
      if (!data.ok) return resEl.innerHTML = '❌ Lỗi: ' + (data.error || '');

      const jobId = data.jobId;

      // poll kết quả
      const poll = setInterval(async () => {
        const s = await fetch(`/api/status?jobId=${jobId}`);
        const result = await s.json();
        if (result.ok && result.status === 'done') {
          clearInterval(poll);
          const r = result.result;
          let color = 'gray';
          if (r.status.toLowerCase() === 'good') color = '#c8f7c5';
          if (r.status.toLowerCase() === 'revoked') color = '#f9c0c0';
          if (r.status.toLowerCase() === 'expired') color = '#f9e79d';

          resEl.innerHTML = `
            <div style="background:${color};padding:10px;border-radius:6px;">
              <p><b>CertName:</b> ${r.certName}</p>
              <p><b>Effective Date:</b> ${r.effectiveDate}</p>
              <p><b>Expiration Date:</b> ${r.expirationDate}</p>
              <p><b>Status:</b> ${r.status}</p>
            </div>
          `;
        } else if (result.ok && result.status === 'error') {
          clearInterval(poll);
          resEl.innerHTML = '❌ Lỗi khi check: ' + JSON.stringify(result.result);
        }
      }, 1000);

    } catch (err) {
      resEl.innerHTML = '⚠️ Lỗi kết nối: ' + err.message;
    }
  });
});

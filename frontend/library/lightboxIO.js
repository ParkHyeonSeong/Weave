// blob을 임시 anchor[download]로 저장
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 동기 revoke는 Firefox/일부 Safari에서 다운로드가 시작되기 전에 URL을 무효화해
  // 실패/0바이트가 될 수 있어 약간 지연시켜 해제한다.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 같은 출처(/api/uploads)면 쿠키 인증으로 받아 blob 저장(원본 파일명, SVG attachment 헤더 우회).
// cross-origin/CORS 실패 시 src를 직접 가리키는 anchor로 폴백.
// 반환: blob 경로로 저장하면 true, 폴백이면 false.
export async function downloadImage(src, filename) {
  try {
    const res = await fetch(src, { credentials: 'include' });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const blob = await res.blob();
    saveBlob(blob, filename);
    return true;
  } catch {
    const a = document.createElement('a');
    a.href = src;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return false;
  }
}

// blob을 PNG로 변환(클립보드는 image/png가 가장 호환성 높음). 이미 png면 그대로.
function toPngBlob(blob) {
  if (blob.type === 'image/png') return Promise.resolve(blob);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('toBlob failed'))), 'image/png');
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

// 이미지를 클립보드에 복사. 실패(미지원/CORS/권한/404) 시 throw — 호출부가 토스트 처리.
export async function copyImageToClipboard(src) {
  const res = await fetch(src, { credentials: 'include' });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const raw = await res.blob();
  const png = await toPngBlob(raw);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  return true;
}

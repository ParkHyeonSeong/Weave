/**
 * Typst WASM 컴파일러 싱글톤 유틸리티
 * - $typst 편의 API 사용
 * - SVG 렌더링 및 PDF 내보내기 지원
 */

let typstModule = null;
let initPromise = null;

async function getTypst() {
  if (typstModule) return typstModule;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { $typst, preloadRemoteFonts } = await import('@myriaddreamin/typst.ts');

    // WASM 바이너리 + 폰트를 모두 로컬(public/)에서 로드 — CDN 의존 제거.
    // 기본값은 cdn.jsdelivr.net에서 텍스트 폰트 17종을 Promise.all로 fetch하는데,
    // 사내망/방화벽/오프라인에서 하나라도 실패하면 "Failed to fetch"로 컴파일 전체가
    // 실패한다. assetUrlPrefix로 typst 기본 텍스트 폰트(Libertinus/NewCM/DejaVu)를
    // 로컬 /fonts/에서 로드하고, 한글 글리프 fallback용으로 앱이 이미 번들한
    // Pretendard(전체 한글 커버)를 추가 로드한다.
    $typst.setCompilerInitOptions({
      getModule: () =>
        fetch('/wasm/typst_ts_web_compiler_bg.wasm').then((r) => r.arrayBuffer()),
      beforeBuild: [
        preloadRemoteFonts(
          [
            '/assets/fonts/Pretendard-Regular.otf',
            '/assets/fonts/Pretendard-Bold.otf',
          ],
          {
            assets: ['text'],
            assetUrlPrefix: { text: '/fonts/' },
          }
        ),
      ],
    });

    $typst.setRendererInitOptions({
      getModule: () =>
        fetch('/wasm/typst_ts_renderer_bg.wasm').then((r) => r.arrayBuffer()),
    });

    typstModule = $typst;
    return $typst;
  })().catch((err) => {
    // init 실패(폰트/WASM fetch 등)를 영구 캐시하지 않는다. 캐시하면 일시적
    // 네트워크 오류가 세션 내내 컴파일 불가로 굳어 새로고침해야만 복구된다.
    // initPromise를 비워 다음 호출에서 재시도하도록 한다.
    initPromise = null;
    throw err;
  });

  return initPromise;
}

/**
 * Typst 소스를 SVG 문자열로 컴파일
 * @param {string} source - Typst 소스 코드
 * @returns {Promise<{ svg: string|null, errors: string[] }>}
 */
export async function compileToSvg(source) {
  try {
    const $typst = await getTypst();
    const svg = await $typst.svg({ mainContent: source });
    return { svg, errors: [] };
  } catch (err) {
    return { svg: null, errors: [err.message || String(err)] };
  }
}

/**
 * Typst 소스를 PDF Uint8Array로 컴파일
 * @param {string} source - Typst 소스 코드
 * @returns {Promise<{ pdf: Uint8Array|null, errors: string[] }>}
 */
export async function compileToPdf(source) {
  try {
    const $typst = await getTypst();
    const pdf = await $typst.pdf({ mainContent: source });
    return { pdf, errors: [] };
  } catch (err) {
    return { pdf: null, errors: [err.message || String(err)] };
  }
}

/**
 * PDF 다운로드 트리거
 * @param {string} source - Typst 소스 코드
 * @param {string} filename - 다운로드 파일명
 */
export async function downloadPdf(source, filename = 'document.pdf') {
  const { pdf, errors } = await compileToPdf(source);
  if (!pdf) throw new Error(errors.join('\n'));

  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

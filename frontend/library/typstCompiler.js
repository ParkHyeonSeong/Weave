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
    const { $typst } = await import('@myriaddreamin/typst.ts');

    // WASM 바이너리를 public/wasm에서 fetch
    $typst.setCompilerInitOptions({
      getModule: () =>
        fetch('/wasm/typst_ts_web_compiler_bg.wasm').then((r) => r.arrayBuffer()),
    });

    $typst.setRendererInitOptions({
      getModule: () =>
        fetch('/wasm/typst_ts_renderer_bg.wasm').then((r) => r.arrayBuffer()),
    });

    typstModule = $typst;
    return $typst;
  })();

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

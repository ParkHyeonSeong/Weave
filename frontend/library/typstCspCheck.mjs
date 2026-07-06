// prod CSP(script-src에 unsafe-eval 없음) 등가 환경에서 앱의 Typst SVG 경로 전체
// (compile → vector → renderSvg)가 동작하는지 검사. typstCsp.test.js가
// `node --disallow-code-generation-from-strings`(new Function/eval을 CSP처럼
// EvalError로 차단하는 V8 플래그)로 이 스크립트를 실행한다.
//
// 브라우저의 typstCompiler.js와 동일하게 wasm은 ArrayBuffer로 직접 공급하고,
// 폰트는 네트워크 없이 public/fonts의 실파일을 Uint8Array로 로드한다.
// $typst 싱글톤은 쓰지 않는다 — 노드에서는 브라우저에 없는 node 전용 분기
// (snippet.mjs doPrepareUse의 new Function)를 타서 오탐하므로, 브라우저와 등가인
// compiler+renderer 직접 조합으로 검증한다. renderSvg는 container 없이 호출하면
// DOM 없이 SVG 문자열을 반환한다(renderer.mjs svg_data 경로).
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const nm = path.join(here, '..', 'node_modules', '@myriaddreamin');
const load = (...p) => import(pathToFileURL(path.join(nm, ...p)).href);
// Buffer는 더 큰 공유 ArrayBuffer의 view일 수 있어 buffer 프로퍼티를 그대로 못 쓴다
const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const { createTypstCompiler } = await load('typst.ts', 'dist', 'esm', 'compiler.mjs');
const { createTypstRenderer } = await load('typst.ts', 'dist', 'esm', 'renderer.mjs');
const { preloadRemoteFonts } = await load('typst.ts', 'dist', 'esm', 'options.init.mjs');
const compilerWrapper = await load('typst-ts-web-compiler', 'pkg', 'wasm-pack-shim.mjs');
const rendererWrapper = await load('typst-ts-renderer', 'pkg', 'wasm-pack-shim.mjs');

const cWasm = readFileSync(
  path.join(nm, 'typst-ts-web-compiler', 'pkg', 'typst_ts_web_compiler_bg.wasm')
);
const rWasm = readFileSync(
  path.join(nm, 'typst-ts-renderer', 'pkg', 'typst_ts_renderer_bg.wasm')
);
const font = new Uint8Array(
  readFileSync(path.join(here, '..', 'public', 'fonts', 'LibertinusSerif-Regular.otf'))
);

const compiler = createTypstCompiler();
await compiler.init({
  getWrapper: () => compilerWrapper,
  getModule: () => toArrayBuffer(cWasm),
  beforeBuild: [preloadRemoteFonts([font], { assets: false })],
});

compiler.addSource('/main.typ', '= CSP check\nHello, Typst!');
// compile()은 { result: Uint8Array } 래퍼를 반환한다(스니펫 $typst.pdf()도 res.result로 푼다)
const { result: vector } = await compiler.compile({ mainFilePath: '/main.typ' });
if (!(vector instanceof Uint8Array) || vector.length === 0) {
  throw new Error(`compile produced empty vector artifact: ${vector && vector.length}`);
}

const renderer = createTypstRenderer();
await renderer.init({
  getWrapper: () => rendererWrapper,
  getModule: () => toArrayBuffer(rWasm),
});
const svg = await renderer.runWithSession(async (session) => {
  renderer.manipulateData({ renderSession: session, action: 'reset', data: vector });
  return renderer.renderSvg({ renderSession: session });
});
if (typeof svg !== 'string' || !svg.includes('<svg')) {
  throw new Error(`renderSvg produced unexpected output: ${typeof svg}`);
}
console.log('TYPST_CSP_OK vector:', vector.length, 'svg:', svg.length);

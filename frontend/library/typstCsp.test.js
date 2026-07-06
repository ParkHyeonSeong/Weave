import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// typst.ts는 컴파일러 init 중 new Function() 생성을 요구했었다(wasm 더미 콜백 5회 +
// loadFonts escapeImport 1회). prod CSP는 unsafe-eval이 없어 이것이 전부
// EvalError("call to Function() blocked by CSP")로 터진다. dev CSP에는 unsafe-eval이
// 있어 dev에서는 재현 불가이므로, CSP 등가 V8 플래그를 켠 자식 프로세스로 검증한다.
// 검사 범위는 앱의 SVG 경로 전체(compile→vector→renderSvg) — 렌더러 glue의 잠재
// new Function 심이 재활성화되는 회귀도 함께 잡는다.
describe('typst svg pipeline under CSP (no unsafe-eval)', () => {
  it('compiles and renders SVG without code generation from strings', () => {
    let out;
    try {
      out = execFileSync(
        process.execPath,
        ['--disallow-code-generation-from-strings', path.join(here, 'typstCspCheck.mjs')],
        { encoding: 'utf8', timeout: 120_000 }
      );
    } catch (err) {
      throw new Error(`typstCspCheck failed:\n${err.stderr || err.message}`);
    }
    expect(out).toContain('TYPST_CSP_OK');
  }, 150_000);
});

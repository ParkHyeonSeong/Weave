// 실제 mathjax full 번들로 MATHJAX_CONFIG의 \href/URL 차단 + 확장 커버리지를 종단 증명.
// 실증으로 고정하는 사실들:
//  - tex-svg(비-full) 번들은 amscd 등을 autoload하다 번들 환경에서 실패 → \begin{CD}가
//    에러 렌더. full 번들은 사전 로드라 정상 (CD 케이스가 번들 회귀를 감지)
//  - html만 제외하면 \require{html}이 html을 재로드해 이후 \href까지 뚫림 → require도 제외
//    (require-then-href 케이스가 이 우회를 감지)
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { MATHJAX_CONFIG } from './mathRender';
import { sanitizeSvg } from './sanitize';

const require = createRequire(import.meta.url);
let win;

beforeAll(async () => {
  const bundle = fs.readFileSync(require.resolve('mathjax/es5/tex-svg-full.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  win = dom.window;
  win.eval(`window.MathJax = ${JSON.stringify(MATHJAX_CONFIG)};`);
  win.eval(bundle);
  await new Promise((resolve) => {
    const wait = () => (win.MathJax.startup?.promise ? resolve() : setTimeout(wait, 100));
    wait();
  });
  await win.MathJax.startup.promise;
}, 30000);

async function renderTex(tex) {
  const out = await win.MathJax.tex2svgPromise(tex, { display: false });
  return out.outerHTML;
}

describe('MathJax \\href/URL 차단 (실제 번들)', () => {
  it('\\href{javascript:...}는 앵커/URL 없이 렌더되고 sanitizeSvg 후에도 안전', async () => {
    const html = await renderTex('\\href{javascript:alert(1)}{x}');
    expect(html).not.toMatch(/<a[\s>]/i);
    expect(html).not.toContain('javascript:');
    const svgMatch = html.match(/<svg[\s\S]*<\/svg>/);
    expect(svgMatch).toBeTruthy();
    const clean = sanitizeSvg(svgMatch[0]);
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toMatch(/<a[\s>]/i);
  }, 20000);

  it('\\href{https://...} 외부 URL도 생성되지 않음', async () => {
    const html = await renderTex('\\href{https://evil.example}{x}');
    expect(html).not.toMatch(/<a[\s>]/i);
    expect(html).not.toContain('evil.example');
  }, 20000);

  it('\\require{html} 우회 후의 \\href도 차단됨 (require 패키지 제외 회귀)', async () => {
    await renderTex('\\require{html}\\href{javascript:alert(1)}{x}'); // 재로드 시도
    const html = await renderTex('\\href{javascript:alert(1)}{x}');   // 같은 문서의 후속 수식
    expect(html).not.toMatch(/<a[\s>]/i);
    expect(html).not.toContain('javascript:');
  }, 20000);

  it('KaTeX 미지원 확장(\\begin{CD})이 에러 없이 렌더됨 (full 번들 회귀)', async () => {
    const html = await renderTex('\\begin{CD} A @>>> B \\end{CD}');
    expect(html).toContain('<svg');
    expect(html).not.toContain('data-mjx-error');
  }, 20000);

  it('정상 수식은 SVG로 렌더됨 (가드가 일반 렌더를 깨지 않음)', async () => {
    const html = await renderTex('E=mc^2');
    expect(html).toContain('<svg');
    expect(html).not.toContain('data-mjx-error');
  }, 20000);
});

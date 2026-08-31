// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import DOMPurify from 'isomorphic-dompurify';
import { sanitizeHtml, sanitizeSvg } from './sanitize.js';
import { TIPTAP_COLOR_MAP } from './tiptapColorMap.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('sanitizeSvg — 순수 SVG 구조 보존 (Typst 렌더가 깨지지 않음)', () => {
  it('svg/g/rect/path/text/use/defs 등 벡터 요소를 보존', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><defs>'
      + '<symbol id="g1"><path d="M0 0L10 10"></path></symbol></defs><g>'
      + '<rect x="0" y="0" width="10" height="10"></rect>'
      + '<use href="#g1"></use>'
      + '<use xlink:href="#g1"></use>'
      + '<text>hi</text>'
      + '</g></svg>';
    const out = sanitizeSvg(svg);
    expect(out).toContain('<svg');
    expect(out).toContain('<rect');
    expect(out).toContain('<path');
    expect(out).toContain('<text');
    expect(out).toContain('<use');
    expect(out).toContain('#g1');     // href 내부 참조 보존
    expect(out).toContain('xlink');   // typst.ts 버전에 따라 쓰는 xlink:href 변형도 보존
    expect(out).toContain('hi');
  });
});

describe('sanitizeSvg — XSS 벡터 제거', () => {
  it('script 태그 제거', () => {
    const out = sanitizeSvg('<svg><script>alert(1)</script><rect></rect></svg>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('<rect');
  });

  it('onload/onclick 등 이벤트 핸들러 제거', () => {
    const out = sanitizeSvg('<svg onload="alert(1)"><rect onclick="evil()"></rect></svg>');
    expect(out).not.toMatch(/onload/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toContain('alert(1)');
  });

  it('javascript: href 제거', () => {
    const out = sanitizeSvg('<svg><a href="javascript:alert(1)"><rect></rect></a></svg>');
    expect(out).not.toContain('javascript:');
  });

  it('빈/널 입력은 그대로 반환', () => {
    expect(sanitizeSvg('')).toBe('');
    expect(sanitizeSvg(null)).toBe(null);
  });

  // 알려진 잔여(의도적): DOMPurify IS_ALLOWED_URI가 http/https를 허용하므로 외부 href는
  // 남는다. Typst WASM은 내부 #참조만 생성하므로 실제 경로엔 영향 없음 — 이 동작을 명시해
  // 미래에 통과하는 테스트를 잘못 "수정"하지 않도록 문서화한다.
  it('외부 use href는 살아남음(알려진 잔여)', () => {
    const out = sanitizeSvg('<svg><use href="http://external/file.svg#g1"></use></svg>');
    expect(out).toContain('<use');
  });

  it('외부 image href는 살아남음(알려진 잔여)', () => {
    const out = sanitizeSvg('<svg><image href="http://tracker.example/px.gif"></image></svg>');
    expect(out).toContain('<image');
  });
});

describe('sanitizeHtml — 회귀(기존 동작 유지)', () => {
  it('일반 태그 보존, script 제거', () => {
    const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain('<p>hi</p>');
    expect(out).not.toContain('<script');
  });

  it('수식 노드의 data-type/data-latex 보존', () => {
    const inline = '<span data-type="inline-math" data-latex="E=mc^2"></span>';
    const block = '<div data-type="block-math" data-latex="x &lt; y"></div>';
    expect(sanitizeHtml(inline)).toContain('data-latex="E=mc^2"');
    expect(sanitizeHtml(inline)).toContain('data-type="inline-math"');
    expect(sanitizeHtml(block)).toContain('data-type="block-math"');
  });
});

describe('sanitizeHtml — 팔레트 색을 시맨틱 클래스로 치환한다', () => {
  it('텍스트 색 인라인 선언을 지우고 wv-tc-* 클래스를 붙인다', () => {
    const out = sanitizeHtml('<p><span style="color: #DC2626">red</span></p>');
    expect(out).toContain('class="wv-tc-dc2626"');
    expect(out).not.toContain('#DC2626');
    expect(out).not.toMatch(/style="[^"]*color/);
  });

  it('하이라이트는 background-color만 지우고 color: inherit은 남긴다', () => {
    const out = sanitizeHtml(
      '<p><mark data-color="#FEF08A" style="background-color: #FEF08A; color: inherit">hl</mark></p>',
    );
    expect(out).toContain('wv-hl-fef08a');
    expect(out).toContain('color: inherit');
    expect(out).not.toContain('background-color');
  });

  it('같은 색이라도 mark는 hl, td는 cell로 가고 rgb 형태도 흡수한다', () => {
    expect(sanitizeHtml('<p><mark style="background-color: #FEF08A">m</mark></p>')).toContain('wv-hl-fef08a');
    const cell = sanitizeHtml('<table><tbody><tr><td style="background-color: rgb(254, 240, 138)">c</td></tr></tbody></table>');
    expect(cell).toContain('wv-cell-fef08a');
    expect(cell).not.toContain('rgb(254, 240, 138)');
  });

  it.each([
    ['#dc2626', 'wv-tc-dc2626'],
    ['#DC2626', 'wv-tc-dc2626'],
    ['rgb(220, 38, 38)', 'wv-tc-dc2626'],
  ])('직렬화 변형 %s도 %s로 치환된다', (value, cls) => {
    expect(sanitizeHtml(`<p><span style="color: ${value}">x</span></p>`)).toContain(cls);
  });

  it('팔레트 밖 색은 손대지 않는다', () => {
    const out = sanitizeHtml('<p><span style="color: #123456">x</span></p>');
    expect(out).toContain('#123456');
    expect(out).not.toContain('wv-tc-');
  });

  it('기존 클래스를 지우지 않는다', () => {
    const out = sanitizeHtml('<p><span class="keepme" style="color: #DC2626">x</span></p>');
    expect(out).toContain('keepme');
    expect(out).toContain('wv-tc-dc2626');
  });

  it('26값 전부가 치환된다', () => {
    for (const e of TIPTAP_COLOR_MAP) {
      const tag = e.kind === 'cell'
        ? `<table><tbody><tr><td style="${e.prop}: ${e.light}">x</td></tr></tbody></table>`
        : `<p><span style="${e.prop}: ${e.light}">x</span></p>`;
      // span에 background-color를 주면 하이라이트 맵으로 간다
      const out = sanitizeHtml(tag);
      if (e.kind === 'cell' || e.kind === 'text') {
        expect(out, e.light).toContain(e.className);
      } else {
        expect(out, e.light).toContain(`wv-hl-${e.light.slice(1).toLowerCase()}`);
      }
    }
  });

  it('빈 style 속성을 남기지 않는다', () => {
    const out = sanitizeHtml('<p><span style="color: #DC2626">x</span></p>');
    expect(out).not.toContain('style=""');
    expect(out).not.toContain('style=" "');
  });

  // ── CSSOM 최종 유효 선언 계약 (raw.split(';') 금지의 근거) ──────────────────
  it('known → unknown 중복: 최종 unknown이 유지되고 wv-* 클래스가 없다', () => {
    const out = sanitizeHtml('<p><span style="color: #DC2626; color: #123456">x</span></p>');
    expect(out).not.toContain('wv-tc-');
    expect(out).toMatch(/#123456|rgb\(18, 52, 86\)/);
  });

  it('unknown → known 중복: 클래스 하나만 붙고 그 property가 통째로 제거된다', () => {
    const out = sanitizeHtml('<p><span style="color: #123456; color: #DC2626">x</span></p>');
    expect(out).toContain('wv-tc-dc2626');
    expect(out).not.toContain('#123456');   // 죽은 선언이 남아 클래스를 이기면 안 된다
    expect(out).not.toContain('color:');
  });

  it('known → known 중복: 마지막 유효색 클래스 하나만 붙는다', () => {
    const out = sanitizeHtml('<p><span style="color: #DC2626; color: #16A34A">x</span></p>');
    expect(out).toContain('wv-tc-16a34a');
    expect(out).not.toContain('wv-tc-dc2626');
  });

  it('!important가 섞인 중복도 CSSOM 최종 유효값을 따른다', () => {
    // 같은 선언 블록 안에서는 순서와 무관하게 !important가 이긴다(Chrome 151·jsdom 실측)
    const won = sanitizeHtml('<p><span style="color: #DC2626 !important; color: #123456">x</span></p>');
    expect(won).toContain('wv-tc-dc2626');
    const lost = sanitizeHtml('<p><span style="color: #DC2626; color: #123456 !important">x</span></p>');
    expect(lost).not.toContain('wv-tc-');
  });

  it.each([
    ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['data:image/svg+xml;utf8,<svg/>', 'svg+xml;utf8,'],
  ])('세미콜론을 포함한 data URI의 의미가 보존된다 (%s)', (uri, needle) => {
    const out = sanitizeHtml(`<p><span style="color: #DC2626; background-image: url('${uri}')">x</span></p>`);
    expect(out).toContain('wv-tc-dc2626');
    expect(out).toContain(needle);
    expect(out).not.toContain('xml; base64');   // split이 만들던 파손 형태
    expect(out).not.toContain('xml; utf8');
  });

  it('팔레트 밖 property는 같은 값이어도 유지된다', () => {
    const out = sanitizeHtml('<p><span style="border-color: #DC2626; font-weight: 700">x</span></p>');
    expect(out).not.toContain('wv-tc-');
    expect(out).toContain('border-color');
    expect(out).toContain('font-weight');
  });

  // ── 기존 wv 클래스 충돌 (인라인 선언이 이긴다) ─────────────────────────────
  // 읽기 표면은 같은 HTML을 반복 정화할 수 있고, 저장 문서에 예전 클래스가 이미 들어 있을
  // 수도 있다. classList.add만 하면 낡은 클래스가 남아 !important끼리 충돌한다.
  it('기존 wv-tc 클래스 + 인라인 팔레트색 → 정본 클래스 하나만 남는다', () => {
    const out = sanitizeHtml('<p><span class="wv-tc-16a34a" style="color: #DC2626">x</span></p>');
    expect(out).toContain('wv-tc-dc2626');
    expect(out).not.toContain('wv-tc-16a34a');
  });

  it('기존 wv-tc 클래스 + 인라인 팔레트 밖 색 → 기존 클래스 제거, 인라인 보존', () => {
    const out = sanitizeHtml('<p><span class="wv-tc-16a34a" style="color: #123456">x</span></p>');
    expect(out).not.toContain('wv-tc-');
    expect(out).toMatch(/#123456|rgb\(18, 52, 86\)/);
  });

  it.each([
    ['TD', 'wv-cell-fef08a'],
    ['MARK', 'wv-hl-fef08a'],
  ])('%s: 기존 wv-hl/wv-cell + 알려진 background-color → 정본 배경 클래스 하나', (tag, want) => {
    const inner = `<${tag.toLowerCase()} class="wv-hl-bbf7d0 wv-cell-bfdbfe" style="background-color: #FEF08A">c</${tag.toLowerCase()}>`;
    const out = sanitizeHtml(tag === 'TD' ? `<table><tbody><tr>${inner}</tr></tbody></table>` : `<p>${inner}</p>`);
    expect(out).toContain(want);
    expect(out).not.toContain('wv-hl-bbf7d0');
    expect(out).not.toContain('wv-cell-bfdbfe');
  });

  it('unrelated 클래스와 반대 속성 wv 클래스는 보존된다', () => {
    const out = sanitizeHtml('<p><span class="keepme wv-hl-bbf7d0 wv-tc-16a34a" style="color: #DC2626">x</span></p>');
    expect(out).toContain('keepme');
    expect(out).toContain('wv-hl-bbf7d0');     // background 쪽 인라인 선언이 없으므로 건드리지 않는다
    expect(out).toContain('wv-tc-dc2626');
    expect(out).not.toContain('wv-tc-16a34a');
  });

  it('인라인 해당 속성이 없으면 기존 정본 클래스를 보존한다', () => {
    const out = sanitizeHtml('<p><span class="wv-tc-16a34a" style="font-weight: 700">x</span></p>');
    expect(out).toContain('wv-tc-16a34a');
    expect(out).toContain('font-weight');
  });

  it('두 번 sanitize해도 결과가 같다 (멱등)', () => {
    const src = '<p><span class="wv-tc-16a34a" style="color: #DC2626">x</span></p>';
    const once = sanitizeHtml(src);
    expect(sanitizeHtml(once)).toBe(once);
  });

  // ── background 축약은 대상이 아니다 ────────────────────────────────────────
  it.each([
    ['<p><span style="background: #FEF08A">x</span></p>', 'background'],
    ['<table><tbody><tr><td style="background: #FEF08A">c</td></tr></tbody></table>', 'background'],
    ['<p><span style="background: url(\'data:image/svg+xml;utf8,<svg/>\') #FEF08A">x</span></p>', 'svg+xml;utf8,'],
  ])('축약 background만 있으면 원문을 보존하고 클래스를 붙이지 않는다 (%#)', (html, needle) => {
    const out = sanitizeHtml(html);
    expect(out).not.toContain('wv-');
    expect(out).toContain(needle);
  });

  it('명시된 longhand는 background-image와 함께 있어도 변환된다', () => {
    const out = sanitizeHtml('<p><span style="background-image: url(\'data:image/svg+xml;utf8,<svg/>\'); background-color: #FEF08A">x</span></p>');
    expect(out).toContain('wv-hl-fef08a');
    expect(out).toContain('svg+xml;utf8,');
  });

  it('data URI 안의 프로퍼티 이름에 속지 않는다', () => {
    const out = sanitizeHtml('<p><span style="color: #DC2626; background-image: url(\'data:text/css;background-color: red\')">x</span></p>');
    expect(out).toContain('wv-tc-dc2626');
    expect(out).not.toContain('wv-hl-');
    expect(out).not.toContain('wv-cell-');
  });

  // raw style 문자열을 정규식으로 훑으면 아래 셋이 전부 "background-color 선언 있음"으로
  // 오인된다(실측). CSSStyleDeclaration의 indexed property 목록만이 정본이다.
  it.each([
    ['CSS 주석 속 가짜 이름', 'background:#FEF08A; /* ; background-color:#BBF7D0 */'],
    ['custom property 문자열 속 가짜 이름', '--x:"; background-color:#BBF7D0"; background:#FEF08A'],
    ['대문자 URL 속 가짜 이름', 'background-image:URL("data:text/css;background-color:red"); background:#FEF08A'],
  ])('%s — shorthand passthrough, wv 클래스 0', (_label, style) => {
    const out = sanitizeHtml(`<p><span style='${style}'>x</span></p>`);
    expect(out).not.toContain('wv-');
    expect(out).toMatch(/#FEF08A|rgb\(254, 240, 138\)/i);
  });

  it.each([
    ['background 뒤 background-color', 'background: #FEF08A; background-color: #BBF7D0'],
    ['background-color 뒤 background', 'background-color: #BBF7D0; background: #FEF08A'],
  ])('축약·longhand 혼합 (%s)은 미처리하고 원문 의미를 보존한다', (_label, style) => {
    const out = sanitizeHtml(`<p><span style="${style}">x</span></p>`);
    expect(out).not.toContain('wv-');
    expect(out).toContain('background');
  });

  // 넓은 fail-closed 경계를 고정한다. background-repeat/position/size 등이 섞이면
  // background-color가 명시 longhand여도 **미처리**다. 정본 TipTap 흐름은 color /
  // background-color longhand만 만들므로 이 조합은 비정본 HTML이고, 다크 보정보다
  // 원문 보존을 우선한다. ⛔ 좁히려고 엔진별 분기나 raw style 정규식을 만들지 마라.
  it('background-repeat가 섞이면 background-color를 미처리한다 (넓은 fail-closed)', () => {
    const out = sanitizeHtml('<p><span style="background-color: #FEF08A; background-repeat: no-repeat">x</span></p>');
    expect(out).not.toContain('wv-');
    expect(out).toMatch(/background-color\s*:/);
    expect(out).toMatch(/#FEF08A|rgb\(254, 240, 138\)/i);
    expect(out).toContain('no-repeat');
  });

  // ── fail-closed 경로의 stale 클래스 (원문 의미 보존 계약) ─────────────────
  // 미처리로 인라인을 남기면서 낡은 wv 클래스도 같이 남기면 `!important` 클래스가
  // 인라인을 이겨 **화면이 예전 색으로 바뀐다** — fail-closed가 오히려 원문을 깬다.
  // 그래서 "CSSOM에 실제 색 값이 있다"는 것만으로 같은 속성의 owned class를 먼저 지운다.
  it('stale wv-hl-* + background-color + background-repeat → stale 제거, 인라인 양쪽 보존, 새 wv 0', () => {
    const out = sanitizeHtml('<p><mark class="wv-hl-bbf7d0" style="background-color:#FEF08A; background-repeat:no-repeat">x</mark></p>');
    expect(out).not.toContain('wv-hl-bbf7d0');
    expect(out).not.toMatch(/wv-(tc|hl|cell)-/);
    expect(out).toMatch(/background-color\s*:/);
    expect(out).toMatch(/#FEF08A|rgb\(254, 240, 138\)/i);
    expect(out).toContain('no-repeat');
  });

  it('stale wv-hl-* + background 축약 → stale 제거, 축약 보존, 새 wv 0', () => {
    const out = sanitizeHtml('<p><mark class="wv-hl-bbf7d0" style="background:#FEF08A">x</mark></p>');
    expect(out).not.toContain('wv-hl-bbf7d0');
    expect(out).not.toMatch(/wv-(tc|hl|cell)-/);
    expect(out).toMatch(/background\s*:/);
    expect(out).toMatch(/#FEF08A|rgb\(254, 240, 138\)/i);
  });

  it('색 선언이 없으면 (background-repeat만) 기존 wv-hl-*를 보존한다', () => {
    // 인라인이 그 속성을 주장하지 않으므로 클래스가 유일한 색 소스다 — 지우면 색이 사라진다.
    const out = sanitizeHtml('<p><mark class="wv-hl-bbf7d0" style="background-repeat:no-repeat">x</mark></p>');
    expect(out).toContain('wv-hl-bbf7d0');
    expect(out).toContain('no-repeat');
  });

  it('background-color + vertical-align은 정상 변환된다 (축약 흔적이 아니다)', () => {
    const out = sanitizeHtml('<table><tbody><tr><td style="background-color: #FEF08A; vertical-align: middle">c</td></tr></tbody></table>');
    expect(out).toContain('wv-cell-fef08a');
    expect(out).toContain('vertical-align');
  });

  it('축약과 명시 color가 함께 있으면 color만 변환하고 축약은 축약으로 남는다', () => {
    const out = sanitizeHtml('<p><span style="background: #FEF08A; color: #DC2626">x</span></p>');
    expect(out).toContain('wv-tc-dc2626');
    expect(out).not.toContain('background-color');   // 축약이 longhand로 펼쳐지면 안 된다
    expect(out).toMatch(/background\s*:/);
  });

  it('CSSOM이 폐기한 무효 선언은 "선언 없음"으로 취급한다', () => {
    const out = sanitizeHtml('<p><span class="wv-tc-16a34a" style="color: rgb(220, 38 38)">x</span></p>');
    expect(out).toContain('wv-tc-16a34a');   // 인라인이 무효라 클래스를 건드릴 이유가 없다
  });

  // ⛔ 이전 판의 원자성 테스트는 **아무것도 검출하지 못했다.** 예외를 일으키지 않아
  //    finally를 밟지 않았고, `sanitizeSvg`의 `fill`은 `paletteClassFor` 대상 프로퍼티가
  //    아니라 hook이 그대로 남아 있어도 결과에 `wv-*`가 나올 수 없다(실측: hook을 일부러
  //    남긴 채 sanitizeSvg를 돌려도 출력에 wv-* 0건). 아래처럼 **실제로 1회 throw**시키고
  //    hook 제거를 **행동으로** 단정한다.
  it('sanitize가 throw해도 hook이 남지 않는다 — 다음 정화가 오염되지 않는다', () => {
    const spy = vi.spyOn(DOMPurify, 'sanitize').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => sanitizeHtml('<p><span style="color: #DC2626">x</span></p>')).toThrow('boom');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();

    // hook이 남아 있었다면 DOMPurify 직접 호출에도 클래스가 붙고 <br>이 주입된다
    const direct = DOMPurify.sanitize('<p><span style="color: #DC2626">x</span></p>', {
      USE_PROFILES: { html: true },
    });
    expect(direct).not.toContain('wv-');
    expect(direct).toMatch(/#DC2626|rgb\(220, 38, 38\)/i);
    expect(DOMPurify.sanitize('<p></p>', { USE_PROFILES: { html: true } })).not.toContain('<br');

    // 과잉 제거도 아니다 — 다음 정상 호출은 여전히 동작한다
    expect(sanitizeHtml('<p><span style="color: #DC2626">x</span></p>')).toContain('wv-tc-dc2626');
    expect(sanitizeHtml('<p></p>')).toContain('<br');
  });

  it('기존 fillEmptyParagraph 동작이 유지된다', () => {
    expect(sanitizeHtml('<p></p>')).toContain('<br');
  });
});

describe('storedColor.scss ↔ 매핑표 parity', () => {
  const scss = readFileSync(resolve(here, '../styles/components/common/storedColor.scss'), 'utf8');
  const darkIdx = scss.indexOf("html[data-theme='dark']");
  const lightPart = scss.slice(0, darkIdx);
  const darkPart = scss.slice(darkIdx);

  it.each(TIPTAP_COLOR_MAP)('$className: 라이트는 원본, 다크는 매핑값', (e) => {
    expect(lightPart, `light ${e.className}`).toMatch(
      new RegExp(`\\.${e.className}\\b[^{]*\\{[^}]*${e.prop}:\\s*${e.light}\\s*!important`, 'i'),
    );
    expect(darkPart, `dark ${e.className}`).toMatch(
      new RegExp(`\\.${e.className}\\b[^{]*\\{[^}]*${e.prop}:\\s*${e.dark}\\s*!important`, 'i'),
    );
  });

  it('SCSS에 매핑표 밖의 wv- 클래스가 없다', () => {
    const declared = new Set([...scss.matchAll(/\.(wv-[a-z]+-[0-9a-f]{6})\b/g)].map((m) => m[1]));
    const known = new Set(TIPTAP_COLOR_MAP.map((e) => e.className));
    expect([...declared].filter((c) => !known.has(c))).toEqual([]);
  });
});

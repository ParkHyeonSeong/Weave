import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';
import postcss from 'postcss';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

// _themes.scss의 다크 블록에서 토큰 값을 실제 컴파일로 뽑는다.
// offline.html은 이 파일을 import 할 수 없어 값을 복제하므로, 복제본이 원본과
// 어긋나는 것을 막는 유일한 장치가 이 대조다.
function darkTokens() {
  const css = compile(resolve(ROOT, 'styles/_themes.scss')).css;
  const out = {};
  postcss.parse(css).walkRules((rule) => {
    if (!/\[data-theme=['"]?dark['"]?\]/.test(rule.selector)) return;
    rule.walkDecls((d) => { if (d.prop.startsWith('--')) out[d.prop] = d.value.trim(); });
  });
  return out;
}

// dark 미디어 블록의 본문만 중괄호 카운트로 잘라낸다. 정규식으로는 안쪽 .icon 규칙
// 때문에 틀린다(아래 drift 가드 주석과 같은 이유). 카운트는 base64/url()에 중괄호가 없어 안전하다.
function darkMediaBody(html) {
  const at = html.search(/@media\s*\(prefers-color-scheme:\s*dark\)/);
  if (at < 0) return null;
  const open = html.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0, i = open;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return depth === 0 ? html.slice(open + 1, i) : null;
}
const LIGHT_URI = /<img[^>]*class="icon"[^>]*src="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"/;
const DARK_URI = /\.icon\s*\{[^}]*content:\s*url\(\s*["']?data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)["']?\s*\)/;

describe('offline.html — CSP-safe Retry', () => {
  const html = read('public/offline.html');

  it('인라인 이벤트 핸들러가 0건이다 (script-src에 unsafe-inline이 없어 실행되지 않는다)', () => {
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('Retry가 href="" 앵커다 (document.URL 재탐색 = 원래 가려던 주소)', () => {
    expect(html).toMatch(/<a[^>]*class="retry"[^>]*href=""[^>]*>/);
  });

  it('<script> 태그가 없다 (캐시된 nonce는 설치 시점의 죽은 값이라 원리적으로 불가)', () => {
    expect(html).not.toMatch(/<script\b/i);
  });
});

describe('offline.html — 테마 대응', () => {
  const html = read('public/offline.html');

  it('prefers-color-scheme dark 블록이 있다 (여기만 OS 기준 — 의도된 예외)', () => {
    expect(html).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
  });

  it('color-scheme을 선언해 폼/스크롤바 기본색도 따라온다', () => {
    expect(html).toMatch(/color-scheme:\s*light dark/);
  });

  it('다크 값이 _themes.scss 다크 팔레트의 복제본과 일치한다 (drift 가드)', () => {
    const t = darkTokens();
    // dark 미디어의 :root 블록 본문만 뽑는다. 미디어 블록 전체를 중괄호 균형으로 잡으려
    // 하면 안쪽 .icon 규칙 때문에 정규식이 틀린다 — :root 한 겹만 본다.
    const media = html.match(/@media\s*\(prefers-color-scheme:\s*dark\)[\s\S]*?:root\s*\{([\s\S]*?)\}/);
    expect(media, 'dark 미디어의 :root 블록을 못 찾았다').toBeTruthy();
    const block = media[1];
    for (const [cssVar, token] of [
      ['--off-bg', '--color-bg'],
      ['--off-text', '--color-text'],
      ['--off-muted', '--color-text-secondary'],
      ['--off-accent', '--color-primary'],
      ['--off-accent-hover', '--color-primary-hover'],
      ['--off-accent-ink', '--color-text-inverse'],
    ]) {
      const m = block.match(new RegExp(`${cssVar}:\\s*([^;]+);`));
      expect(m, `${cssVar}가 dark 블록에 없다`).toBeTruthy();
      expect(m[1].trim().toUpperCase(), `${cssVar} != ${token}`).toBe(t[token].toUpperCase());
    }
  });
});

describe('offline.html — 오프라인 자산', () => {
  const html = read('public/offline.html');

  it('빌드 자리표시자가 남아 있지 않다 (⟪…⟫ 0건)', () => {
    expect(html, 'LIGHT 자리표시자 잔존').not.toContain('⟪LIGHT_B64⟫');
    expect(html, 'DARK 자리표시자 잔존').not.toContain('⟪DARK_B64⟫');
    expect(html.match(/⟪[^⟫]*⟫/g) ?? [], '치환되지 않은 자리표시자').toEqual([]);
  });

  // 길이 검사는 증거가 못 된다 — 두 SVG의 base64는 둘 다 908자이고 앞 194자가 같다.
  // decode해서 원본 바이트와 대조하는 것만이 light/dark 뒤바뀜·위조를 잡는다.
  it('light data URI가 icons/weave_square.svg 바이트와 정확히 같다', () => {
    const m = html.match(LIGHT_URI);
    expect(m, '<img class="icon">의 base64 data URI를 못 찾았다').toBeTruthy();
    const bytes = Buffer.from(m[1], 'base64');
    expect(bytes.toString('base64'), 'light base64가 정규 인코딩이 아니다').toBe(m[1]);
    expect(bytes.equals(readFileSync(resolve(ROOT, 'public/icons/weave_square.svg'))),
      'light 로고가 weave_square.svg와 다르다').toBe(true);
  });

  it('dark data URI가 dark 미디어 안에 있고 icons/weave_square_dark.svg 바이트와 정확히 같다', () => {
    const body = darkMediaBody(html);
    expect(body, 'prefers-color-scheme: dark 미디어 블록을 못 찾았다').toBeTruthy();
    const m = body.match(DARK_URI);
    expect(m, 'dark 미디어 안의 .icon content: url(data:…)를 못 찾았다').toBeTruthy();
    const bytes = Buffer.from(m[1], 'base64');
    expect(bytes.toString('base64'), 'dark base64가 정규 인코딩이 아니다').toBe(m[1]);
    expect(bytes.equals(readFileSync(resolve(ROOT, 'public/icons/weave_square_dark.svg'))),
      'dark 로고가 weave_square_dark.svg와 다르다').toBe(true);
  });

  it('네트워크를 타는 서브리소스 참조가 0건이다', () => {
    expect(html).not.toMatch(/(?:src|href)="\/(?!\s)/);   // href="" 는 통과, href="/…" 는 실패
    expect(html).not.toMatch(/<link\b[^>]*rel=["']stylesheet/i);
  });
});

describe('sw.js — 캐시 갱신 경로', () => {
  const sw = read('public/sw.js');

  // ⚠️ 종결 따옴표를 넣지 않는다. CACHE_NAME은 'weave-offline-v2-<sha8>' 형태라
  //    /…-v(\d+)'/ 로 잡으면 매치에 실패한다.
  it('CACHE_NAME이 v2 이상이다', () => {
    const m = sw.match(/const CACHE_NAME = 'weave-offline-v(\d+)/);
    expect(m, "CACHE_NAME 선언을 못 찾았다").toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(2);
  });

  // 버전 단정은 단조 래칫이라 offline.html을 몇 번 고쳐도 통과한다.
  // 캐시 이름을 본문 해시에 결속해야 "본문만 고치고 sw.js를 안 올렸다"가 RED가 된다.
  // install은 /sw.js의 바이트 변경으로만 발화하고 캐시 쓰기는 install 안에만 있으므로,
  // 그 실수는 기존 설치자에게 영구 no-op이 된다.
  it('CACHE_NAME이 offline.html 콘텐츠 해시와 결속돼 있다', () => {
    const want = createHash('sha256')
      .update(read('public/offline.html'), 'utf8').digest('hex').slice(0, 8);
    const m = sw.match(/const CACHE_NAME = 'weave-offline-v(\d+)-([0-9a-f]{8})';/);
    expect(m, "CACHE_NAME이 'weave-offline-v<N>-<sha8>' 형태가 아니다").toBeTruthy();
    expect(m[2], `offline.html이 바뀌었는데 sw.js의 CACHE_NAME을 안 올렸다 (기대 ${want})`).toBe(want);
  });

  it('skipWaiting + clients.claim이 살아 있다 (새로고침 1회로 반영되는 근거)', () => {
    expect(sw).toMatch(/self\.skipWaiting\(\)/);
    expect(sw).toMatch(/self\.clients\.claim\(\)/);
  });

  it('activate가 CACHE_NAME 아닌 캐시를 지운다', () => {
    expect(sw).toMatch(/keys\.filter\(\(k\) => k !== CACHE_NAME\)/);
  });

  it('offline.html이 프리캐시 대상이다', () => {
    expect(sw).toMatch(/OFFLINE_URL = '\/offline\.html'/);
    expect(sw).toMatch(/cache\.add\(OFFLINE_URL\)/);
  });

  it('caches.match 미스 시 Response.error()로 방어한다 (respondWith(undefined) 금지)', () => {
    expect(sw).toMatch(/Response\.error\(\)/);
    expect(sw).toMatch(/await caches\.match\(OFFLINE_URL\)/);
  });

  it('navigation 전용 전략을 유지한다 (서브리소스 가로채기로 확대하지 않는다)', () => {
    expect(sw).toMatch(/event\.request\.mode === 'navigate'/);
  });
});

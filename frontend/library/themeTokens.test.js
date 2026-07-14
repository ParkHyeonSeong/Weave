import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from 'sass';

// _themes.scss 계약: 컴파일 결과에 flat 블록 3개 —
//   [0] :root(라이트) [1] html[data-theme='dark'](다크) [2] :root(테마불변 별칭)
// [0]/[1]의 --키 집합이 다르면 한쪽 테마에서 반대 테마 값이 상속 누출된다.
const css = compile(resolve(__dirname, '../styles/_themes.scss')).css;
// ⚠️ sass 1.97은 attribute selector의 불필요한 따옴표를 제거한다: html[data-theme=dark]
//    (따옴표 필수 매칭이면 별칭 블록을 dark로 오인 — 리뷰 재현 [52,5]) — unquoted 허용 필수.
const blocks = [...css.matchAll(/(?::root|html\[data-theme=(?:dark|["']dark["'])\])\s*\{([^}]*)\}/g)]
  .map((m) => new Set([...m[1].matchAll(/--([a-z0-9-]+)\s*:/g)].map((k) => k[1])));
const [light, dark, aliases = new Set()] = blocks;

describe('_themes.scss 토큰 대칭', () => {
  it('라이트/다크 블록이 존재하고 비어있지 않다', () => {
    expect(light?.size).toBeGreaterThan(30);
    expect(dark?.size).toBeGreaterThan(30);
  });
  it('라이트에만 있는 키가 없다', () => {
    expect([...light].filter((k) => !dark.has(k))).toEqual([]);
  });
  it('다크에만 있는 키가 없다', () => {
    expect([...dark].filter((k) => !light.has(k))).toEqual([]);
  });
});

// 라이트 무변화(핵심 수용 기준)를 값 수준으로 고정 — 키 대칭만으로는 라이트 값 오타를 못 잡는다.
// 기존 30토큰의 현행 리터럴(코어 팔레트)만 단정: 파생 토큰은 sass가 결정론 계산하므로 원본 고정으로 충분.
const LIGHT_BASELINE = {
  'color-bg': '#FFFFFF', 'color-surface': '#F9FAFB', 'color-surface-hover': '#F3F4F6',
  'color-primary': '#5E6AD2', 'color-primary-hover': '#4F5BC0',
  'color-primary-subtle': 'rgba(94, 106, 210, 0.08)',
  'color-text': '#1C1C1C', 'color-text-secondary': '#6B7280', 'color-text-tertiary': '#6B7280',
  'color-text-inverse': '#FFFFFF',
  'color-border': '#E5E5E5', 'color-border-hover': '#D1D5DB',
  'color-input-bg': '#FFFFFF', 'color-input-border': '#E5E5E5',
  'color-error': '#DC2626', 'color-error-bg': '#FEF2F2',
  'color-success': '#16A34A', 'color-success-bg': '#F0FDF4',
  'color-warning': '#D97706', 'color-warning-bg': '#FFFBEB',
  'color-code-bg': '#F1F3F5', 'color-code-text': '#EB5757', 'color-code-block-bg': '#F6F8FA',
  'color-ref-doc': '#C2410C', 'color-ref-doc-bg': '#FFF7ED',
  'color-ref-issue': '#8B5CF6', 'color-ref-issue-bg': '#F5F3FF',
  'color-status-in-progress': '#1E40AF', 'color-status-in-progress-bg': '#DBEAFE',
};

describe('라이트 값 무변화 — 컴파일된 :root 값이 현행 팔레트와 동일', () => {
  it('코어 30토큰 값 일치', () => {
    const rootBlock = css.match(/:root\s*\{([^}]*)\}/)[1];
    const values = Object.fromEntries(
      [...rootBlock.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
    );
    for (const [k, v] of Object.entries(LIGHT_BASELINE)) {
      expect(values[k], `--${k}`).toBe(v);
    }
  });
});

describe('브리지 커버리지 — _variables.scss가 참조하는 var는 전부 정의돼 있어야 한다', () => {
  // Task 5 플립 전에는 참조 0개라 공허 통과, 플립 후부터 실효.
  // _variables에 토큰이 추가되는데 _themes에 빠지면(예: warning-bg 사후 추가) 여기서 잡힌다.
  it('미정의 참조 없음', () => {
    const bridge = readFileSync(resolve(__dirname, '../styles/_variables.scss'), 'utf8');
    const refs = [...bridge.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]);
    const defined = new Set([...light, ...aliases]);
    expect([...new Set(refs)].filter((r) => !defined.has(r))).toEqual([]);
  });
});

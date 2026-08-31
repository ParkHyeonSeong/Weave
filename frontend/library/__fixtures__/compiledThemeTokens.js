// _themes.scss를 **컴파일해서** 토큰 실값을 읽는 테스트 공용 헬퍼.
//
// 왜 정규식이 아니라 컴파일인가:
//   `--color-surface-raised` · `--track-paper-raised`는 `color.adjust(...)` 파생이라
//   소스에 hex가 없다. 소스를 hex 정규식으로 읽던 종전 방식은 이 두 값을 **아예 못 봤고**,
//   그래서 TrackHeader 그라데이션의 아래쪽 끝(= 다크 최악 부모)이 계약에서 빠져 있었다.
//   컴파일 산출을 읽으면 파생 토큰도 브라우저와 같은 값으로 잡힌다.
//
// ⚠️ vitest include는 `library/**/*.test.js`라 이 파일은 테스트로 수집되지 않는다.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileString } from 'sass';
import { mixSrgb, rgbToHex } from '../colorContrast.js';

const here = dirname(fileURLToPath(import.meta.url));
const stylesDir = resolve(here, '../../styles');

const css = compileString(
  readFileSync(resolve(stylesDir, '_themes.scss'), 'utf8'),
  { loadPaths: [stylesDir] },
).css;

const darkAt = css.indexOf('[data-theme=dark]');
if (darkAt < 0) throw new Error('_themes.scss 컴파일 산출에 다크 블록이 없다');
const CHUNK = { light: css.slice(0, darkAt), dark: css.slice(darkAt) };

// sass는 파생 토큰을 `rgb(252.06, 252.55, 253.04)`처럼 소수로 낸다.
// 브라우저 computed도 같은 반올림을 하므로(실측 rgb(252, 253, 253)) 정수 hex로 맞춘다.
function toHex(raw) {
  const v = String(raw).trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(v)) return v.toUpperCase();
  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (!m) throw new Error(`hex로 못 바꾸는 토큰 값: ${raw}`);
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return rgbToHex([p[0], p[1], p[2]]);
}

/** 토큰 선언의 **원문**(정규화 전). 불투명 여부를 판정하려면 hex가 아니라 이 문자열을 봐야 한다. */
export function rawTokenOf(theme, name) {
  const m = CHUNK[theme].match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`${theme}에 --${name} 토큰이 없다`);
  return m[1].trim();
}

/** 불투명 토큰의 실값(hex). 없으면 던진다 — 오타가 조용히 통과하지 않게. */
export function tokenOf(theme, name) {
  const m = CHUNK[theme].match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`${theme}에 --${name} 토큰이 없다`);
  return toHex(m[1]);
}

/** 반투명 토큰을 { hex, pct }로. */
export function rgbaTokenOf(theme, name) {
  const m = CHUNK[theme].match(new RegExp(`--${name}:\\s*rgba\\(([^)]+)\\)`));
  if (!m) throw new Error(`${theme}에 --${name} rgba 토큰이 없다`);
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return { hex: rgbToHex([p[0], p[1], p[2]]), pct: p[3] * 100 };
}

/** 반투명 토큰을 baseHex 위에 합성한 색 — CSS가 실제로 칠하는 값과 같은 수학. */
export function tokenOver(theme, rgbaName, baseHex) {
  const { hex, pct } = rgbaTokenOf(theme, rgbaName);
  return mixSrgb(hex, baseHex, pct);
}

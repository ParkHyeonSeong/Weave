// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Editor } from '@tiptap/core';
import { buildCanvasEditorExtensions } from '@/components/Canvas/canvasEditorExtensions';
import { TEXT_COLORS, HIGHLIGHT_COLORS, CELL_BG_COLORS } from './tiptapColorMap.js';
import { sanitizeHtml } from './sanitize.js';

import BASELINE from './tiptapCanonical.baseline.json';

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(here, 'tiptapCanonical.baseline.json');

// Task 0이 동결한 원본 바이트의 SHA-256. ⛔ 이 값을 현재 파일 해시로 갱신하지 마라 —
// 그 순간 이 게이트는 자기 자신을 확인하는 self-bless가 된다(§7).
const BASELINE_SHA256 = 'a9abb750647146ca32221a30eab44f0b6b5d204a4f585aa3b8e9c9bab3183c2e';

// Task 0의 baseline 입력 생성 규칙. 팔레트 정본(tiptapColorMap.js)에서 다시 만들어
// baseline의 key 목록과 순서까지 대조한다 — Object.keys(BASELINE)만 순회하면 baseline에서
// 항목을 지워도 "지워진 답안지"를 그대로 따라가 GREEN이 된다.
const EXPECTED_INPUTS = [
  ...TEXT_COLORS.map((c) => `<p><span style="color: ${c}">t</span></p>`),
  ...HIGHLIGHT_COLORS.map(
    (c) => `<p><mark data-color="${c}" style="background-color: ${c}; color: inherit">h</mark></p>`,
  ),
  ...CELL_BG_COLORS.map(
    (c) => `<table><tbody><tr><td style="background-color: ${c}">c</td></tr></tbody></table>`,
  ),
];

// Editor는 호출마다 만들고 같은 호출에서 반드시 destroy한다. 전역 인스턴스를 덮어쓰고
// afterEach에서 마지막 하나만 정리하면 고정점 루프가 만든 Editor가 통째로 남는다.
// ⛔ 수동 카운터로 자기보고하지 마라 — destroy 호출과 독립이라 `ed.destroy()`를 지워도
//    카운터만 맞으면 GREEN이다. 아래 lifecycle 테스트가 Editor.prototype.destroy를
//    spy로 잡아 **실제 호출**을 본다.
const canon = (html) => {
  const ed = new Editor({ extensions: buildCanvasEditorExtensions({}), content: html });
  try {
    return ed.getHTML();
  } finally {
    ed.destroy();
  }
};

describe('baseline은 동결본이다 — self-bless 차단', () => {
  it('baseline 원본 바이트의 SHA-256이 Task 0 동결값과 exact다', () => {
    const sha = createHash('sha256').update(readFileSync(BASELINE_PATH)).digest('hex');
    expect(sha).toBe(BASELINE_SHA256);
  });

  it('baseline 입력 key가 팔레트 정본에서 생성한 26개와 순서·집합 모두 exact다', () => {
    expect(TEXT_COLORS).toHaveLength(12);
    expect(HIGHLIGHT_COLORS).toHaveLength(6);
    expect(CELL_BG_COLORS).toHaveLength(8);
    expect(EXPECTED_INPUTS).toHaveLength(26);
    // length만 보면 key 하나를 지우고 다른 하나를 복제해도 통과한다 — 전체 배열을 대조한다.
    expect(Object.keys(BASELINE)).toEqual(EXPECTED_INPUTS);
  });
});

describe('저장 canonical — S7 적용 전/후가 같다', () => {
  it.each(EXPECTED_INPUTS)('%s의 canonical이 baseline과 같다', (input) => {
    expect(canon(input)).toBe(BASELINE[input]);
  });

  it('canonical은 1 pass 고정점이다', () => {
    for (const input of EXPECTED_INPUTS) {
      const once = canon(input);
      expect(canon(once), input).toBe(once);
    }
  });

  it('style 속성에 hex는 남지 않는다 — 열거 선택자가 rgb형만 쓰는 근거', () => {
    for (const out of Object.values(BASELINE)) {
      expect(out.match(/style="[^"]*#[0-9a-fA-F]{3,8}/), out).toBeNull();
    }
  });

  it('hex가 살아남는 자리는 data-color뿐이다', () => {
    const withDataColor = '<p><mark data-color="#FEF08A" style="background-color: #FEF08A; color: inherit">hl</mark></p>';
    expect(canon(withDataColor)).toContain('data-color="#FEF08A"');
    // 대소문자도 setAttribute 경로라 보존된다 — mark[data-color=… i]가 필요한 이유
    expect(canon(withDataColor.replaceAll('#FEF08A', '#fef08a'))).toContain('data-color="#fef08a"');
  });

  // Task 0 입력 규칙의 baseline 키. 다른 문자열을 쓰면 BASELINE[…]가 undefined라 가짜 RED가 된다.
  const DC2626 = '<p><span style="color: #DC2626">t</span></p>';

  it('sanitizeHtml은 읽기 관문이라 canonical을 바꾸지 않는다', () => {
    expect(sanitizeHtml(DC2626)).not.toBe(DC2626);   // 읽기 관문은 변환한다
    expect(canon(DC2626)).toBe(BASELINE[DC2626]);    // 저장 canonical은 그대로다
  });

  it('읽기 변환 결과를 다시 편집기에 넣으면 색이 소실된다 — 저장 경로에 태우면 안 되는 이유', () => {
    const roundTripped = canon(sanitizeHtml(DC2626));
    expect(roundTripped).not.toContain('rgb(220, 38, 38)');   // 클래스만 남아 색 마크가 사라진다
    expect(roundTripped).not.toBe(BASELINE[DC2626]);
  });

  // 이 두 테스트는 다른 테스트의 실행 여부·순서에 의존하지 않는다(-t 단독 실행도 GREEN).
  it('canon()은 만든 Editor마다 destroy를 실제로 호출한다', () => {
    const destroySpy = vi.spyOn(Editor.prototype, 'destroy');
    try {
      const before = destroySpy.mock.calls.length;
      canon(EXPECTED_INPUTS[0]);
      canon(EXPECTED_INPUTS[1]);
      canon(EXPECTED_INPUTS[2]);
      expect(destroySpy.mock.calls.length - before).toBe(3);
    } finally {
      destroySpy.mockRestore();
    }
  });

  it('getHTML()이 throw해도 finally가 destroy를 호출한다', () => {
    const destroySpy = vi.spyOn(Editor.prototype, 'destroy');
    const getSpy = vi.spyOn(Editor.prototype, 'getHTML')
      .mockImplementationOnce(() => { throw new Error('boom'); });
    try {
      const before = destroySpy.mock.calls.length;
      expect(() => canon(EXPECTED_INPUTS[0])).toThrow('boom');
      expect(destroySpy.mock.calls.length - before).toBe(1);
    } finally {
      getSpy.mockRestore();
      destroySpy.mockRestore();
    }
  });
});

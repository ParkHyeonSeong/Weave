// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { buildMarkdownExtensions } from './markdownCodec';
import { enterRawState, parseRawToHtml, formatUnsupportedWarning } from './rawMode';

// StarterKit v3에는 underline/link 포함 — TaskDescriptionEditor.js:26-29와 동일 전제
const extensions = buildMarkdownExtensions([StarterKit]);

function makeEditor(content) {
  return new Editor({ extensions, content });
}

let editor;
afterEach(() => { editor?.destroy(); editor = undefined; });

describe('enterRawState', () => {
  it('bold 문단을 markdown으로 직렬화하고 경고는 없다', () => {
    editor = makeEditor('<p><strong>굵게</strong> 텍스트</p>');
    const { markdown, warnings } = enterRawState(editor);
    expect(markdown).toContain('**굵게**');
    expect(warnings).toEqual([]);
  });

  it('underline 마크는 ++text++로 무손실 왕복하므로 warnings에 들어가지 않는다', () => {
    editor = makeEditor('<p><u>밑줄</u></p>');
    const { markdown, warnings } = enterRawState(editor);
    expect(markdown).toContain('++밑줄++');
    expect(warnings).not.toContain('underline');
  });
});

describe('parseRawToHtml', () => {
  it('markdown을 에디터 HTML로 파싱한다', () => {
    expect(parseRawToHtml('**bold** 텍스트', extensions)).toContain('<strong>bold</strong>');
  });

  it('공백뿐인 입력은 null (빈 문서 시맨틱)', () => {
    expect(parseRawToHtml('', extensions)).toBeNull();
    expect(parseRawToHtml('  \n  ', extensions)).toBeNull();
  });

  it('왕복: doc → md → html → 다시 md가 동일', () => {
    editor = makeEditor('<p>안녕 <em>세계</em></p><ul><li><p>하나</p></li></ul>');
    const { markdown } = enterRawState(editor);
    editor.commands.setContent(parseRawToHtml(markdown, extensions));
    // 실측(2026-07-09): StarterKit의 TrailingNode 플러그인은 dispatch된 트랜잭션에서만
    // 동작해 initial construction(new Editor({content}))에는 안 붙지만, setContent()
    // 호출(=exitRaw()가 쓰는 것과 동일 경로)이 dispatch하는 트랜잭션에는 붙어 마지막이
    // 문단이 아닌 문서(리스트로 끝남) 뒤에 빈 문단을 추가한다 — rawMode.js 자체의
    // 비순수성이 아니라 tiptap/StarterKit의 실제 동작(코덱은 두 번 다 동일 입력에
    // 동일 출력을 낸다: 첫 markdown은 setContent 이전 JSON, 두번째는 이후 JSON).
    expect(enterRawState(editor).markdown).toBe(`${markdown}\n\n&nbsp;`);
  });
});

describe('formatUnsupportedWarning', () => {
  it('빈 배열/undefined면 null', () => {
    expect(formatUnsupportedWarning([])).toBeNull();
    expect(formatUnsupportedWarning(undefined)).toBeNull();
  });
  it('알려진 키는 한국어 라벨로', () => {
    expect(formatUnsupportedWarning(['underline', 'color'])).toBe(
      '일부 서식(밑줄, 글자색)은 markdown으로 표현되지 않아 단순화됩니다'
    );
  });
  it('모르는 키는 그대로 노출', () => {
    expect(formatUnsupportedWarning(['weirdMark'])).toContain('weirdMark');
  });
});

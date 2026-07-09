// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  buildMarkdownExtensions, docToMarkdown, sliceToMarkdown,
  htmlToMarkdown, markdownToEditorHtml, findUnsupportedFormatting,
} from './markdownCodec';

const BASE = [StarterKit];

let editor;
afterEach(() => { editor?.destroy(); editor = undefined; });

describe('docToMarkdown', () => {
  it('에디터 문서 전체를 markdown으로 직렬화한다', () => {
    editor = new Editor({ extensions: BASE, content: '<h1>제목</h1><p><strong>본문</strong></p>' });
    expect(docToMarkdown(editor).trim()).toBe('# 제목\n\n**본문**');
  });
  it('buildMarkdownExtensions 장착 에디터에서도 동일 + getMarkdown 배선', () => {
    editor = new Editor({ extensions: buildMarkdownExtensions(BASE), content: '<p>hi</p>' });
    expect(docToMarkdown(editor).trim()).toBe('hi');
    expect(editor.getMarkdown().trim()).toBe('hi');
  });
});

describe('sliceToMarkdown', () => {
  it('블록 단위 선택을 직렬화한다', () => {
    editor = new Editor({ extensions: BASE, content: '<p>one</p><p>two</p>' });
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    expect(sliceToMarkdown(editor, slice).trim()).toBe('one\n\ntwo');
  });
  it('문단 중간 인라인 선택은 문단으로 감싸 직렬화한다', () => {
    editor = new Editor({ extensions: BASE, content: '<p>hello <strong>world</strong></p>' });
    // pos 3은 "hello " 세번째 문자 앞이 아니라 두번째 문자(index 2) 앞이다(ProseMirror
    // 위치는 문단 콘텐츠 시작을 pos 1로 잡으므로 0-based 문자열 인덱스와 1 어긋난다).
    // 실측(slice.content.toJSON()): [{text:'llo '}, {text:'wor', marks:[bold]}].
    const slice = editor.state.doc.slice(3, 10); // 'llo ' + 굵은 'wor'
    expect(sliceToMarkdown(editor, slice).trim()).toBe('llo **wor**');
  });
  it('빈 조각은 빈 문자열', () => {
    editor = new Editor({ extensions: BASE, content: '<p></p>' });
    expect(sliceToMarkdown(editor, editor.state.doc.slice(1, 1))).toBe('');
  });
});

describe('htmlToMarkdown / markdownToEditorHtml', () => {
  it('HTML → md headless 변환', () => {
    expect(htmlToMarkdown('<h2>부제</h2><p>본문 <code>x</code></p>', BASE).trim()).toBe('## 부제\n\n본문 `x`');
  });
  it('빈 입력은 빈 문자열', () => {
    expect(htmlToMarkdown('', BASE)).toBe('');
    expect(markdownToEditorHtml('', BASE)).toBe('');
  });
  it('md → HTML → md 정착 왕복(dialect 무관 멱등성)', () => {
    const md1 = htmlToMarkdown(markdownToEditorHtml('- 하나\n- 둘\n\n> 인용', BASE), BASE);
    const md2 = htmlToMarkdown(markdownToEditorHtml(md1, BASE), BASE);
    expect(md2).toBe(md1);
    expect(md1).toContain('하나');
    expect(md1).toContain('> 인용');
  });
});

describe('findUnsupportedFormatting', () => {
  it('md 미표현 서식을 수집한다', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { textAlign: 'center' }, content: [
          { type: 'text', text: 'a', marks: [{ type: 'underline' }] },
          { type: 'text', text: 'b', marks: [{ type: 'textStyle', attrs: { color: '#ff0000' } }] },
          { type: 'text', text: 'c', marks: [{ type: 'highlight', attrs: { color: '#fef08a' } }] },
        ] },
        { type: 'image', attrs: { src: 'x.png', width: 300 } },
        { type: 'tableCell', attrs: { backgroundColor: '#eee' }, content: [] },
      ],
    };
    expect(findUnsupportedFormatting(doc).sort()).toEqual(
      ['cellBackground', 'color', 'highlightColor', 'imageWidth', 'textAlign', 'underline'],
    );
  });
  it('지원 서식만 있으면 빈 배열', () => {
    expect(findUnsupportedFormatting({ type: 'doc', content: [{ type: 'paragraph' }] })).toEqual([]);
  });
});

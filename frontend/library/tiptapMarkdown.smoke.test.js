// @vitest-environment jsdom
// @tiptap/markdown 3.20.x API 전제 검증 — 이 전제가 깨지면 markdownCodec.js 설계 재검토.
// 버전업 시 회귀망 역할이므로 유지한다.
import { describe, it, expect } from 'vitest';
import { Editor, createBlockMarkdownSpec, createInlineMarkdownSpec, generateHTML, generateJSON } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Marked, marked } from 'marked';
import { Markdown, MarkdownManager } from '@tiptap/markdown';

describe('@tiptap/markdown API 스모크', () => {
  it('MarkdownManager headless 생성 + serialize/parse 왕복', () => {
    const mgr = new MarkdownManager({ marked: new Marked({ breaks: true }), extensions: [StarterKit] });
    const json = mgr.parse('# 제목\n\n**굵게** 텍스트');
    expect(json.type).toBe('doc');
    expect(json.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    expect(mgr.serialize(json).trim()).toBe('# 제목\n\n**굵게** 텍스트');
  });

  it('Marked 인스턴스 주입 전제: lexer/Lexer/defaults 존재 + 전역 marked 비오염', () => {
    const inst = new Marked({ breaks: true });
    expect(typeof inst.lexer).toBe('function');   // manager.parse가 사용
    expect(typeof inst.Lexer).toBe('function');   // manager 생성자가 사용
    expect(inst.defaults.breaks).toBe(true);
    expect(marked.defaults.breaks).toBe(false);   // 전역은 그대로
  });

  it('Editor + Markdown 확장: contentType markdown 파싱 / editor.markdown.serialize / getMarkdown', () => {
    const editor = new Editor({
      extensions: [StarterKit, Markdown.configure({ marked: new Marked({ breaks: true }) })],
      content: '# Hi',
      contentType: 'markdown',
    });
    expect(editor.getHTML()).toContain('<h1');
    expect(typeof editor.markdown.serialize).toBe('function');
    expect(editor.getMarkdown().trim()).toBe('# Hi');
    editor.destroy();
  });

  it('createBlockMarkdownSpec/createInlineMarkdownSpec가 core에서 import 가능', () => {
    expect(typeof createBlockMarkdownSpec).toBe('function');
    expect(typeof createInlineMarkdownSpec).toBe('function');
  });

  it('generateJSON/generateHTML headless 변환 (jsdom)', () => {
    const json = generateJSON('<p><strong>b</strong></p>', [StarterKit]);
    expect(generateHTML(json, [StarterKit])).toBe('<p><strong>b</strong></p>');
  });
});

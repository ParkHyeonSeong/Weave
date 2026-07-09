// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { buildMarkdownExtensions, htmlToMarkdown } from './markdownCodec';
import { MarkdownClipboardExtension } from '@/components/Canvas/extensions/MarkdownClipboardExtension';
import { buildTaskDescriptionExtensions } from '@/components/Branch/Tasks/taskDescriptionExtensions';
import { buildCommentEditorExtensions } from '@/components/Branch/Tasks/commentEditorExtensions';
import { buildIssueEditorExtensions } from '@/components/Branch/Tasks/issueEditorExtensions';
import { buildScrumCellExtensions } from '@/components/Scrum/scrumCellExtensions';
import { buildCanvasEditorExtensions } from '@/components/Canvas/canvasEditorExtensions';

// 컴포넌트 useMemo와 동일한 조합 (Yjs 런타임 확장만 제외)
const SURFACES = [
  ['taskDesc', () => buildTaskDescriptionExtensions()],
  ['comment', () => buildCommentEditorExtensions()],
  ['issue', () => buildIssueEditorExtensions()],
  ['scrum', () => buildScrumCellExtensions()],
  ['canvas', () => buildCanvasEditorExtensions()],
];

let editor;
afterEach(() => { editor?.destroy(); editor = undefined; });

describe.each(SURFACES)('표면 %s: 클립보드·headless md 배선', (_name, build) => {
  it('선택 복사 시 clipboardTextSerializer가 markdown을 반환한다', () => {
    editor = new Editor({
      extensions: buildMarkdownExtensions([...build(), MarkdownClipboardExtension]),
      content: '<p><strong>bold</strong> plain</p>',
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, editor.state.doc.content.size - 1))
    );
    const text = editor.view.someProp('clipboardTextSerializer', (f) =>
      f(editor.state.selection.content(), editor.view)
    );
    expect(text.trim()).toBe('**bold** plain');
  });

  it('읽기 뷰 headless 변환(htmlToMarkdown)이 동작한다', () => {
    expect(htmlToMarkdown('<p><strong>bold</strong> plain</p>', build()).trim()).toBe('**bold** plain');
  });
});

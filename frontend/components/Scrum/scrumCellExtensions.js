// ScrumCell 확장 배열의 단일 진실원 (Yjs 제외 — 컴포넌트가 런타임에 덧붙임)
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { checklistExtensions } from '@/components/Canvas/extensions/checklistExtension';
import TaskRefNode from '@/components/Canvas/extensions/TaskRefExtension';
import DocRefNode from '@/components/Canvas/extensions/DocRefExtension';
import MentionNode from '@/components/Canvas/extensions/MentionExtension';
import SlashCommandsExtension from '@/components/Canvas/extensions/SlashCommandsExtension';
import { BookmarkPasteExtension } from '@/components/Canvas/extensions/BookmarkPastePlugin';
import { mathExtensions } from '@/components/Canvas/extensions/mathExtensions';
import { createMarkdownPastePlugin } from '@/components/Canvas/extensions/MarkdownPastePlugin';

export function buildScrumCellExtensions({ placeholder, members } = {}) {
  return [
    StarterKit.configure({
      history: false, codeBlock: false, heading: false, blockquote: false, horizontalRule: false,
      link: { openOnClick: false, autolink: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
    }),
    Placeholder.configure({ placeholder: placeholder || '' }),
    ...checklistExtensions({ nested: false }),
    TaskRefNode,
    DocRefNode,
    MentionNode.configure({ members }),
    SlashCommandsExtension.configure({ enabled: ['/t', '/ta', '/d', '/m'] }),
    BookmarkPasteExtension,
    ...mathExtensions(),
    Extension.create({
      name: 'markdownPaste',
      addProseMirrorPlugins() { return [createMarkdownPastePlugin()]; },
    }),
  ];
}

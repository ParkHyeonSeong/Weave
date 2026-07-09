// 스키마 스윕 (스펙 §6.2): 5개 표면의 전 노드/마크에 md 직렬화 핸들러가 있는지 강제.
// @tiptap/markdown은 핸들러 없는 노드를 빈 문자열로 직렬화(무음 드롭)하므로,
// 새 노드/마크를 추가하면 md 스펙을 함께 정의하거나 아래 allowlist에 사유와 함께 올려야 한다.
import { describe, it, expect } from 'vitest';
import { flattenExtensions, getExtensionField } from '@tiptap/core';
import { buildTaskDescriptionExtensions } from '@/components/Branch/Tasks/taskDescriptionExtensions';
import { buildCommentEditorExtensions } from '@/components/Branch/Tasks/commentEditorExtensions';
import { buildIssueEditorExtensions } from '@/components/Branch/Tasks/issueEditorExtensions';
import { buildScrumCellExtensions } from '@/components/Scrum/scrumCellExtensions';
import { buildCanvasEditorExtensions } from '@/components/Canvas/canvasEditorExtensions';

const SURFACES = {
  taskDescription: buildTaskDescriptionExtensions({ branchId: 1 }),
  comment: buildCommentEditorExtensions({ branchId: 1 }),
  issue: buildIssueEditorExtensions({ branchId: 1 }),
  scrumCell: buildScrumCellExtensions({ members: [] }),
  canvas: buildCanvasEditorExtensions({ canvasId: 1 }),
};

// md 표현이 없어 의도적으로 핸들러가 없는 타입 — 드롭은 findUnsupportedFormatting이 경고
// - textStyle: color 전용 mark. 텍스트 자체는 보존된다
// - tableRow/Cell/Header: table 확장의 renderMarkdown이 행/셀을 일괄 직렬화한다
const ALLOWLIST = new Set(['textStyle', 'tableRow', 'tableCell', 'tableHeader']);

for (const [surface, extensions] of Object.entries(SURFACES)) {
  describe(`md 핸들러 스윕: ${surface}`, () => {
    const schemaTypes = flattenExtensions(extensions)
      .filter((ext) => (ext.type === 'node' || ext.type === 'mark') && !ALLOWLIST.has(ext.name));
    it('검사 대상 스키마 타입이 존재한다', () => {
      expect(schemaTypes.length).toBeGreaterThan(10);
    });
    for (const ext of schemaTypes) {
      it(`${ext.type} '${ext.name}'에 renderMarkdown 존재`, () => {
        expect(typeof getExtensionField(ext, 'renderMarkdown')).toBe('function');
      });
    }
  });
}

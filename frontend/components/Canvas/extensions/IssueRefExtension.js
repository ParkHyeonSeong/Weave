import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import IssueRefPopup from './IssueRefPopup';
import { createRefSuggestionPlugin } from './refSuggestion';

export const issueRefPluginKey = new PluginKey('issueRefSuggestion');

const IssueRefNode = Node.create({
  name: 'issueRef',
  group: 'inline',
  inline: true,
  atom: true,

  // per-attr parseHTML: 저장된 HTML 재파싱 시 data-*에서 attrs 복원.
  // per-attr renderHTML은 비활성 — 노드 레벨 renderHTML()이 data-*를 전부 명시 출력하므로
  // 기본 렌더(camelCase 속성 중복 출력)를 억제해 출력 HTML을 data-*만으로 유지한다.
  addAttributes() {
    const numAttr = (name) => (el) => {
      const v = el.getAttribute(name);
      return v != null && v !== '' ? Number(v) : null;
    };
    return {
      issueId: { default: null, parseHTML: numAttr('data-issue-id'), renderHTML: () => ({}) },
      taskId: { default: null, parseHTML: numAttr('data-task-id'), renderHTML: () => ({}) },
      branchId: { default: null, parseHTML: numAttr('data-branch-id'), renderHTML: () => ({}) },
      displayId: { default: '', parseHTML: (el) => el.getAttribute('data-display-id') || '', renderHTML: () => ({}) },
      title: { default: '', parseHTML: (el) => el.getAttribute('data-title') || '', renderHTML: () => ({}) },
      status: { default: 'open', parseHTML: (el) => el.getAttribute('data-status') || 'open', renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-issue-ref]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-issue-ref': 'true',
        'data-issue-id': node.attrs.issueId,
        'data-task-id': node.attrs.taskId,
        'data-branch-id': node.attrs.branchId,
        'data-display-id': node.attrs.displayId,
        'data-title': node.attrs.title,
        'data-status': node.attrs.status,
        class: 'issue-ref',
      }),
      `${node.attrs.displayId} ${node.attrs.title}`,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'issue-ref';
      dom.contentEditable = 'false';
      dom.setAttribute('data-issue-ref', 'true');
      dom.setAttribute('data-branch-id', node.attrs.branchId);
      dom.setAttribute('data-task-id', node.attrs.taskId);
      dom.setAttribute('data-issue-id', node.attrs.issueId);
      dom.setAttribute('data-display-id', node.attrs.displayId);
      dom.title = `${node.attrs.displayId} - ${node.attrs.title}`;

      dom.appendChild(document.createTextNode(`${node.attrs.displayId} ${node.attrs.title}`));

      const badge = document.createElement('span');
      badge.className = `ref-chip__badge ref-chip__badge--${node.attrs.status}`;
      badge.textContent = node.attrs.status === 'open' ? 'Open' : 'Closed';
      badge.setAttribute('data-ref-badge', 'true');
      dom.appendChild(badge);

      dom.addEventListener('click', (e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('canvas:ref_click', {
          detail: { type: 'issue', data: { branchId: node.attrs.branchId, taskId: node.attrs.taskId, issueId: node.attrs.issueId } },
        }));
      });

      return {
        dom,
        selectNode() { dom.classList.add('ProseMirror-selectednode'); },
        deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
      };
    };
  },

  addProseMirrorPlugins() {
    return [
      createRefSuggestionPlugin({
        editor: this.editor,
        pluginKey: issueRefPluginKey,
        Popup: IssueRefPopup,
        buildProps: (st, { close, dismiss, backToMenu, insertRefNode }) => ({
          onClose: close,
          onDismiss: dismiss,
          onBack: backToMenu,
          onSelect: (issue) => insertRefNode('issueRef', {
            issueId: issue.issue_id,
            taskId: issue.task_id,
            branchId: issue.branch_id,
            displayId: issue.display_id,
            title: issue.title,
            status: issue.status,
          }),
        }),
      }),
    ];
  },
});

export default IssueRefNode;

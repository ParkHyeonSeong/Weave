import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import IssueRefPopup from './IssueRefPopup';
import { mapAnchor, createSuggestionPopupView } from './refSuggestion';

export const issueRefPluginKey = new PluginKey('issueRefSuggestion');

const ISSUE_OFF = { active: false, from: 0 };

const IssueRefNode = Node.create({
  name: 'issueRef',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      issueId: { default: null },
      taskId: { default: null },
      branchId: { default: null },
      displayId: { default: '' },
      title: { default: '' },
      status: { default: 'open' },
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
    const editor = this.editor;

    return [
      new Plugin({
        key: issueRefPluginKey,
        state: {
          init() { return ISSUE_OFF; },
          apply(tr, prev) {
            const meta = tr.getMeta(issueRefPluginKey);
            if (meta) return meta;
            if (!prev.active || !tr.docChanged) return prev;
            // 검색어는 input에 있으므로 문서 변경(원격 편집)엔 앵커 추적만
            return mapAnchor(tr, prev, ISSUE_OFF);
          },
        },
        view: createSuggestionPopupView({
          editor,
          pluginKey: issueRefPluginKey,
          off: ISSUE_OFF,
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
      }),
    ];
  },
});

export default IssueRefNode;

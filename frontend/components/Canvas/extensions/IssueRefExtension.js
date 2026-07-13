import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import IssueRefPopup from './IssueRefPopup';
import { createRefSuggestionPlugin } from './refSuggestion';
import { numAttr, strAttr } from './refAttr';
import { internalOrigin, formatRefLabel, matchInternalLink, splitRefLinkText, ISSUE_PATH, encodeMarkdownUrl } from './refMarkdown';

export const issueRefPluginKey = new PluginKey('issueRefSuggestion');

const IssueRefNode = Node.create({
  name: 'issueRef',
  group: 'inline',
  inline: true,
  atom: true,

  // attr 정의·불변식(per-attr 렌더 억제)은 refAttr.js 참고
  addAttributes() {
    return {
      issueId: numAttr('data-issue-id'),
      taskId: numAttr('data-task-id'),
      branchId: numAttr('data-branch-id'),
      displayId: strAttr('data-display-id'),
      title: strAttr('data-title'),
      status: strAttr('data-status', 'open'),
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-issue-ref]' }];
  },

  // === raw markdown 코덱 (스펙 §3.2) ===
  renderMarkdown(node) {
    const { branchId, taskId, issueId, displayId, title } = node.attrs || {};
    return `[${formatRefLabel(displayId, title)}](${encodeMarkdownUrl(`${internalOrigin()}/branch/${branchId}/task/${taskId}/issue/${issueId}`)})`;
  },
  markdownTokenizer: {
    name: 'issueRef',
    level: 'inline',
    start: (src) => src.indexOf('['),
    tokenize(src) {
      const link = matchInternalLink(src);
      if (!link) return undefined;
      const m = link.pathname.match(ISSUE_PATH);
      if (!m) return undefined;
      const { displayId, title } = splitRefLinkText(link.text);
      return { type: 'issueRef', raw: link.raw, branchId: Number(m[1]), taskId: Number(m[2]), issueId: Number(m[3]), displayId, title };
    },
  },
  parseMarkdown(token, h) {
    return h.createNode('issueRef', {
      issueId: token.issueId, taskId: token.taskId, branchId: token.branchId, displayId: token.displayId, title: token.title,
    });
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = node.attrs.status === 'open' ? 'Open' : 'Closed';
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
      ['span', {
        class: `ref-chip__badge ref-chip__badge--${node.attrs.status}`,
        'data-ref-badge': 'true',
      }, label],
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

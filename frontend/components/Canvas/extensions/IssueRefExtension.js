import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import IssueRefPopup from './IssueRefPopup';

const issueRefPluginKey = new PluginKey('issueRefSuggestion');

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
          init() {
            return { active: false, keyword: '', from: 0 };
          },
          apply(tr, prev) {
            const meta = tr.getMeta(issueRefPluginKey);
            if (meta) return meta;
            if (tr.docChanged) return { active: false, keyword: '', from: 0 };
            return prev;
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            const { state } = view;
            const pluginState = issueRefPluginKey.getState(state);

            if (pluginState.active) {
              setTimeout(() => {
                const newState = issueRefPluginKey.getState(view.state);
                if (!newState.active) return;
                const $pos = view.state.doc.resolve(view.state.selection.from);
                const textBefore = $pos.parent.textBetween(
                  Math.max(0, newState.from - $pos.start()),
                  view.state.selection.from - $pos.start(),
                  null,
                  '\ufffc',
                );
                const match = textBefore.match(/\/i\s(.*)$/);
                if (match) {
                  view.dispatch(view.state.tr.setMeta(issueRefPluginKey, {
                    active: true, keyword: match[1], from: newState.from,
                  }));
                } else {
                  view.dispatch(view.state.tr.setMeta(issueRefPluginKey, {
                    active: false, keyword: '', from: 0,
                  }));
                }
              }, 0);
              return false;
            }

            if (text === ' ') {
              const $pos = state.doc.resolve(from);
              const textBefore = $pos.parent.textBetween(
                Math.max(0, from - $pos.start() - 2),
                from - $pos.start(),
                null,
                '\ufffc',
              );
              if (textBefore === '/i' || textBefore.endsWith('/i')) {
                const slashFrom = from - 2;
                setTimeout(() => {
                  view.dispatch(view.state.tr.setMeta(issueRefPluginKey, {
                    active: true, keyword: '', from: slashFrom,
                  }));
                }, 0);
                return false;
              }
            }
            return false;
          },

          handleKeyDown(view, event) {
            const pluginState = issueRefPluginKey.getState(view.state);
            if (!pluginState.active) return false;

            if (event.key === 'Escape') {
              view.dispatch(view.state.tr.setMeta(issueRefPluginKey, {
                active: false, keyword: '', from: 0,
              }));
              return true;
            }

            if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
              return true;
            }

            return false;
          },
        },

        view(editorView) {
          let popup = null;
          let renderer = null;

          function destroyPopup() {
            if (renderer) { renderer.destroy(); renderer = null; }
            if (popup) { popup.remove(); popup = null; }
          }

          function createPopup(pluginState) {
            destroyPopup();

            // viewport 기준 fixed + body append → 컨테이너 종류/클리핑 무관하게 정확히 뜸
            const coords = editorView.coordsAtPos(editorView.state.selection.from);

            popup = document.createElement('div');
            popup.style.position = 'fixed';
            // 우측 가장자리에서 화면 밖으로 넘치지 않게 left 클램프
            popup.style.left = `${Math.min(coords.left, window.innerWidth - 360)}px`;
            popup.style.top = `${coords.bottom + 4}px`;
            popup.style.zIndex = '500';
            document.body.appendChild(popup);
            // 화면 아래로 넘치면 커서 위로 뒤집어 띄움 (하단 셀에서 안 묻히게)
            requestAnimationFrame(() => {
              if (!popup) return;
              const h = popup.offsetHeight;
              if (h && coords.bottom + h + 8 > window.innerHeight) {
                popup.style.top = `${Math.max(8, coords.top - h - 4)}px`;
              }
            });

            renderer = new ReactRenderer(IssueRefPopup, {
              editor,
              props: {
                keyword: pluginState.keyword,
                onSelect: (issue) => {
                  const { state } = editorView;
                  const pluginSt = issueRefPluginKey.getState(state);
                  const tr = state.tr.replaceWith(
                    pluginSt.from,
                    state.selection.from,
                    state.schema.nodes.issueRef.create({
                      issueId: issue.issue_id,
                      taskId: issue.task_id,
                      branchId: issue.branch_id,
                      displayId: issue.display_id,
                      title: issue.title,
                      status: issue.status,
                    }),
                  );
                  tr.setMeta(issueRefPluginKey, { active: false, keyword: '', from: 0 });
                  editorView.dispatch(tr);
                  editorView.focus();
                },
                onClose: () => {
                  editorView.dispatch(
                    editorView.state.tr.setMeta(issueRefPluginKey, {
                      active: false, keyword: '', from: 0,
                    }),
                  );
                },
              },
            });

            popup.appendChild(renderer.element);
          }

          return {
            update(view) {
              const pluginState = issueRefPluginKey.getState(view.state);
              if (pluginState.active) {
                if (renderer) {
                  renderer.updateProps({ keyword: pluginState.keyword });
                } else {
                  createPopup(pluginState);
                }
              } else {
                destroyPopup();
              }
            },
            destroy() {
              destroyPopup();
            },
          };
        },
      }),
    ];
  },
});

export default IssueRefNode;

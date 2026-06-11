import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import DocRefPopup from './DocRefPopup';
import { reparseSuggestion } from './refSuggestion';

export const docRefPluginKey = new PluginKey('docRefSuggestion');

const DocRefNode = Node.create({
  name: 'docRef',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      pageId: { default: null },
      canvasId: { default: null },
      title: { default: '' },
      canvasName: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-doc-ref]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-doc-ref': 'true',
        'data-page-id': node.attrs.pageId,
        'data-canvas-id': node.attrs.canvasId,
        'data-title': node.attrs.title,
        'data-canvas-name': node.attrs.canvasName,
        class: 'doc-ref',
      }),
      node.attrs.title,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'doc-ref';
      dom.contentEditable = 'false';
      dom.setAttribute('data-doc-ref', 'true');
      dom.setAttribute('data-canvas-id', node.attrs.canvasId);
      dom.setAttribute('data-page-id', node.attrs.pageId);
      dom.textContent = node.attrs.title;
      dom.title = `${node.attrs.canvasName} > ${node.attrs.title}`;

      dom.addEventListener('click', (e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('canvas:ref_click', {
          detail: { type: 'doc', data: { canvasId: node.attrs.canvasId, pageId: node.attrs.pageId } },
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
        key: docRefPluginKey,
        state: {
          init() {
            return { active: false, keyword: '', from: 0 };
          },
          apply(tr, prev, _oldState, newState) {
            const meta = tr.getMeta(docRefPluginKey);
            if (meta) return meta;
            if (!prev.active || !tr.docChanged) return prev;
            return reparseSuggestion(prev, tr, newState, /^\/d\s?(.*)$/);
          },
        },
        props: {
          handleKeyDown(view, event) {
            const pluginState = docRefPluginKey.getState(view.state);
            if (!pluginState.active) return false;

            if (event.key === 'Escape') {
              view.dispatch(view.state.tr.setMeta(docRefPluginKey, {
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
          let lastState = null; // 상태 불변 시 updateProps 리렌더 스킵용

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

            renderer = new ReactRenderer(DocRefPopup, {
              editor,
              props: {
                keyword: pluginState.keyword,
                onSelect: (doc) => {
                  const { state } = editorView;
                  const pluginSt = docRefPluginKey.getState(state);
                  const tr = state.tr.replaceWith(
                    pluginSt.from,
                    state.selection.from,
                    state.schema.nodes.docRef.create({
                      pageId: doc.page_id,
                      canvasId: doc.canvas_id,
                      title: doc.title,
                      canvasName: doc.canvas_name,
                    }),
                  );
                  tr.setMeta(docRefPluginKey, { active: false, keyword: '', from: 0 });
                  editorView.dispatch(tr);
                  editorView.focus();
                },
                onClose: () => {
                  editorView.dispatch(
                    editorView.state.tr.setMeta(docRefPluginKey, {
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
              const pluginState = docRefPluginKey.getState(view.state);
              if (pluginState === lastState) return;
              lastState = pluginState;
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

export default DocRefNode;

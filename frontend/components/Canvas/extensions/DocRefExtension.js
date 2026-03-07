import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import DocRefPopup from './DocRefPopup';

const docRefPluginKey = new PluginKey('docRefSuggestion');

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
      dom.textContent = node.attrs.title;
      dom.title = `${node.attrs.canvasName} > ${node.attrs.title}`;
      return { dom };
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
          apply(tr, prev) {
            const meta = tr.getMeta(docRefPluginKey);
            if (meta) return meta;
            if (tr.docChanged) return { active: false, keyword: '', from: 0 };
            return prev;
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            const { state } = view;
            const pluginState = docRefPluginKey.getState(state);

            if (pluginState.active) {
              setTimeout(() => {
                const newState = docRefPluginKey.getState(view.state);
                if (!newState.active) return;
                const $pos = view.state.doc.resolve(view.state.selection.from);
                const textBefore = $pos.parent.textBetween(
                  Math.max(0, newState.from - $pos.start()),
                  view.state.selection.from - $pos.start(),
                  null,
                  '\ufffc',
                );
                const match = textBefore.match(/\/d\s(.*)$/);
                if (match) {
                  view.dispatch(view.state.tr.setMeta(docRefPluginKey, {
                    active: true, keyword: match[1], from: newState.from,
                  }));
                } else {
                  view.dispatch(view.state.tr.setMeta(docRefPluginKey, {
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
              if (textBefore === '/d' || textBefore.endsWith('/d')) {
                const slashFrom = from - 2;
                setTimeout(() => {
                  view.dispatch(view.state.tr.setMeta(docRefPluginKey, {
                    active: true, keyword: '', from: slashFrom,
                  }));
                }, 0);
                return false;
              }
            }
            return false;
          },

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

          function destroyPopup() {
            if (renderer) { renderer.destroy(); renderer = null; }
            if (popup) { popup.remove(); popup = null; }
          }

          function createPopup(pluginState) {
            destroyPopup();

            const coords = editorView.coordsAtPos(editorView.state.selection.from);
            const editorRect = editorView.dom.closest('.CanvasEditor').getBoundingClientRect();

            popup = document.createElement('div');
            popup.style.position = 'absolute';
            popup.style.left = `${coords.left - editorRect.left}px`;
            popup.style.top = `${coords.bottom - editorRect.top + 4}px`;
            popup.style.zIndex = '200';
            editorView.dom.closest('.CanvasEditor').appendChild(popup);

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

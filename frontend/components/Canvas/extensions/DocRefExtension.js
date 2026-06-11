import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import DocRefPopup from './DocRefPopup';
import { createRefSuggestionPlugin } from './refSuggestion';

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
    return [
      createRefSuggestionPlugin({
        editor: this.editor,
        pluginKey: docRefPluginKey,
        Popup: DocRefPopup,
        buildProps: (st, { close, dismiss, backToMenu, insertRefNode }) => ({
          onClose: close,
          onDismiss: dismiss,
          onBack: backToMenu,
          onSelect: (doc) => insertRefNode('docRef', {
            pageId: doc.page_id,
            canvasId: doc.canvas_id,
            title: doc.title,
            canvasName: doc.canvas_name,
          }),
        }),
      }),
    ];
  },
});

export default DocRefNode;

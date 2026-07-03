import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import MathEditPopover from './MathEditPopover';

export const mathEditPluginKey = new PluginKey('mathEdit');
const OFF = { active: false, pos: null, latex: '', kind: 'inline', isNew: false };

const MathEditExtension = Extension.create({
  name: 'mathEdit',

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: mathEditPluginKey,
        state: {
          init() { return { ...OFF }; },
          apply(tr, prev) {
            const meta = tr.getMeta(mathEditPluginKey);
            if (meta) return meta;
            if (!prev.active || !tr.docChanged) return prev;
            return { ...prev, pos: tr.mapping.map(prev.pos) };
          },
        },
        props: {
          handleClickOn(view, _pos, node, nodePos) {
            if (!view.editable) return false;
            if (node.type.name !== 'inlineMath' && node.type.name !== 'blockMath') return false;
            view.dispatch(view.state.tr.setMeta(mathEditPluginKey, {
              active: true,
              pos: nodePos,
              latex: node.attrs.latex || '',
              kind: node.type.name === 'blockMath' ? 'block' : 'inline',
              isNew: false,
            }));
            return true;
          },
        },

        view(editorView) {
          let popup = null;
          let renderer = null;
          let lastState = null;
          let outsideHandler = null;

          function destroyPopup() {
            if (outsideHandler) { document.removeEventListener('mousedown', outsideHandler); outsideHandler = null; }
            if (renderer) { renderer.destroy(); renderer = null; }
            if (popup) { popup.remove(); popup = null; }
          }

          // 저장/취소 모두 디스패치 시점의 fresh 플러그인 상태를 읽는다 — render 클로저의
          // ps.pos는 협업(Yjs) 원격 편집으로 밀릴 수 있고, 리매핑된 pos는 plugin apply()가 들고 있다.
          function saveEdit(view, latex) {
            const ps = mathEditPluginKey.getState(view.state);
            let tr = view.state.tr;
            if (ps?.active) {
              const node = view.state.doc.nodeAt(ps.pos);
              if (node && (node.type.name === 'inlineMath' || node.type.name === 'blockMath')) {
                if (latex.trim()) {
                  tr = tr.setNodeMarkup(ps.pos, undefined, { ...node.attrs, latex });
                } else {
                  tr = tr.delete(ps.pos, ps.pos + node.nodeSize); // 빈 수식은 삭제
                }
              }
            }
            tr = tr.setMeta(mathEditPluginKey, { ...OFF });
            view.dispatch(tr);
          }

          // 취소 단일 경로: 버튼 Cancel/Esc/바깥 클릭 모두 이 함수를 탄다.
          // isNew(방금 /m으로 삽입) 노드는 삭제 — 바깥 클릭이 OFF 메타만 넣으면
          // 빈 <span data-type="inline-math" data-latex="">가 남아 저장까지 된다.
          function cancelEdit(view) {
            const ps = mathEditPluginKey.getState(view.state);
            let tr = view.state.tr;
            if (ps?.active && ps.isNew) {
              const node = view.state.doc.nodeAt(ps.pos);
              if (node && (node.type.name === 'inlineMath' || node.type.name === 'blockMath')) {
                tr = tr.delete(ps.pos, ps.pos + node.nodeSize);
              }
            }
            tr = tr.setMeta(mathEditPluginKey, { ...OFF });
            view.dispatch(tr);
          }

          function render(ps, view) {
            destroyPopup();
            const coords = view.coordsAtPos(ps.pos);
            popup = document.createElement('div');
            popup.style.position = 'fixed';
            popup.style.left = `${Math.min(coords.left, window.innerWidth - 340)}px`;
            popup.style.top = `${coords.bottom + 6}px`;
            popup.style.zIndex = '500';
            document.body.appendChild(popup);
            renderer = new ReactRenderer(MathEditPopover, {
              editor,
              props: {
                latex: ps.latex,
                displayMode: ps.kind === 'block',
                onSave: (latex) => {
                  saveEdit(view, latex);
                  view.focus();
                },
                onCancel: () => {
                  cancelEdit(view);
                  view.focus();
                },
              },
            });
            popup.appendChild(renderer.element);
            // 지속 리스너: 내부 클릭은 무시하고 바깥 클릭에서 닫는다.
            // ({ once: true }는 첫 내부 클릭에 리스너가 소모돼 이후 바깥 클릭이 안 닫히므로 금지 —
            // 등록/해제는 render/destroyPopup 쌍으로 관리)
            outsideHandler = (e) => {
              // 바깥 클릭도 취소 의미론 — isNew 노드 삭제 경로를 동일하게 탄다 (포커스는 안 뺏음)
              if (popup && !popup.contains(e.target)) cancelEdit(editorView);
            };
            setTimeout(() => {
              if (outsideHandler) document.addEventListener('mousedown', outsideHandler);
            }, 0);
          }

          return {
            update(view) {
              const ps = mathEditPluginKey.getState(view.state);
              if (ps === lastState) return;
              lastState = ps;
              if (ps.active) render(ps, view); else destroyPopup();
            },
            destroy() { destroyPopup(); },
          };
        },
      }),
    ];
  },
});

export default MathEditExtension;

import { Plugin } from '@tiptap/pm/state';
import { axios } from '@/library/_axios';

export function createImageUploadPlugin(canvasId) {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const items = Array.from(event.clipboardData?.items || []);
        const imageItem = items.find((item) => item.type.startsWith('image/'));
        if (!imageItem) return false;

        event.preventDefault();
        const file = imageItem.getAsFile();
        if (file) uploadAndInsert(file, canvasId, view);
        return true;
      },

      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files || []);
        const imageFile = files.find((f) => f.type.startsWith('image/'));
        if (!imageFile) return false;

        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        uploadAndInsert(imageFile, canvasId, view, pos?.pos);
        return true;
      },
    },
  });
}

async function uploadAndInsert(file, canvasId, view, insertPos) {
  if (file.size > 5 * 1024 * 1024) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await axios.post(
      `/canvases/${canvasId}/pages/upload-image`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );

    if (res.data.status && res.data.url) {
      const { schema } = view.state;
      const node = schema.nodes.image.create({ src: res.data.url });
      const pos = insertPos != null ? insertPos : view.state.selection.from;
      const tr = view.state.tr.insert(pos, node);
      view.dispatch(tr);
    }
  } catch {}
}

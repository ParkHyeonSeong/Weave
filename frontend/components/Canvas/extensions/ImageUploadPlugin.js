import { Plugin } from '@tiptap/pm/state';
import { axios } from '@/library/_axios';

export function createImageUploadPlugin({ canvasId, branchId }) {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const items = Array.from(event.clipboardData?.items || []);
        const imageItem = items.find((item) => item.type.startsWith('image/'));
        if (!imageItem) return false;

        event.preventDefault();
        const file = imageItem.getAsFile();
        if (file) uploadAndInsert(file, { canvasId, branchId }, view);
        return true;
      },

      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files || []);
        const imageFile = files.find((f) => f.type.startsWith('image/'));
        if (!imageFile) return false;

        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        uploadAndInsert(imageFile, { canvasId, branchId }, view, pos?.pos);
        return true;
      },
    },
  });
}

function getUploadUrl({ canvasId, branchId }) {
  if (canvasId) return `/canvases/${canvasId}/pages/upload-image`;
  if (branchId) return `/branches/${branchId}/tasks/upload-image`;
  return null;
}

async function uploadAndInsert(file, context, view, insertPos) {
  if (file.size > 5 * 1024 * 1024) return;

  const url = getUploadUrl(context);
  if (!url) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await axios.post(url, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    if (res.data.status && res.data.url) {
      const { schema } = view.state;
      const node = schema.nodes.image.create({ src: res.data.url });
      const pos = insertPos != null ? insertPos : view.state.selection.from;
      const tr = view.state.tr.insert(pos, node);
      view.dispatch(tr);
    }
  } catch {}
}

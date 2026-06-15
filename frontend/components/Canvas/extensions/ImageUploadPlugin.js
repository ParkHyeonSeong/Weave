import { Plugin } from '@tiptap/pm/state';
import { axios } from '@/library/_axios';
import { showToast } from '@/components/Layout/Toast';

const MAX_IMAGE_SIZE_MB = 10;
const MAX_IMAGE_SIZE = MAX_IMAGE_SIZE_MB * 1024 * 1024;

// 백엔드 업로드 실패 코드 → 사용자 안내 메시지
function uploadErrorMessage(code) {
  switch (code) {
    case 'FILE_TOO_LARGE':
      return `이미지가 ${MAX_IMAGE_SIZE_MB}MB를 초과해 첨부할 수 없습니다.`;
    case 'INVALID_FILE_TYPE':
    case 'INVALID_FILE_CONTENT':
      return '지원하지 않는 이미지 형식입니다. (JPG·PNG·GIF·WebP)';
    case 'NOT_CANVAS_MEMBER':
    case 'NOT_BRANCH_MEMBER':
      return '이미지를 업로드할 권한이 없습니다.';
    case 'NO_FILE':
      return '첨부할 이미지를 찾을 수 없습니다.';
    default:
      return '이미지 업로드에 실패했습니다.';
  }
}

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
  if (file.size > MAX_IMAGE_SIZE) {
    showToast(uploadErrorMessage('FILE_TOO_LARGE'), 'error');
    return;
  }

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
    } else {
      showToast(uploadErrorMessage(res.data?.message), 'error');
    }
  } catch {
    showToast(uploadErrorMessage(), 'error');
  }
}

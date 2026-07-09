import { Plugin } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import { axios } from '@/library/_axios';

const URL_PATTERN = /^https?:\/\/[^\s]+$/;

// 내부 URL 경로 패턴 — 붙여넣기 판별과 md 코덱(refMarkdown)이 공유하는 단일 정의
export const ISSUE_PATH = /^\/branch\/(\d+)\/task\/(\d+)\/issue\/(\d+)/;
export const TASK_PATH = /^\/branch\/(\d+)\/task\/(\d+)/;
export const DOC_PATH = /^\/canvas\/(\d+)\/(\d+)/;

export function createBookmarkPastePlugin() {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        // HTML 붙여넣기면 무시 (리치 콘텐츠 유지)
        const html = event.clipboardData?.getData('text/html');
        if (html) return false;

        const text = event.clipboardData?.getData('text/plain')?.trim();
        if (!text || !URL_PATTERN.test(text)) return false;

        // 내부 URL인지 판별
        let pathname = '';
        try {
          const parsed = new URL(text);
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          if (origin && parsed.origin === origin) {
            pathname = parsed.pathname;
          }
        } catch {
          // URL 파싱 실패 시 외부로 취급
        }

        // 내부 URL이면 ref 노드로 삽입
        if (pathname) {
          const { schema, tr } = view.state;

          // issue 경로 (task보다 먼저 체크 — task 패턴이 issue에도 매치되므로)
          const issueMatch = pathname.match(ISSUE_PATH);
          if (issueMatch && schema.nodes.issueRef) {
            event.preventDefault();
            const node = schema.nodes.issueRef.create({
              branchId: Number(issueMatch[1]),
              taskId: Number(issueMatch[2]),
              issueId: Number(issueMatch[3]),
              title: 'Loading...',
            });
            view.dispatch(tr.replaceSelectionWith(node));
            fetchIssueInfo(view, Number(issueMatch[1]), Number(issueMatch[2]), Number(issueMatch[3]));
            return true;
          }

          // task 경로
          const taskMatch = pathname.match(TASK_PATH);
          if (taskMatch && schema.nodes.taskRef) {
            event.preventDefault();
            const node = schema.nodes.taskRef.create({
              branchId: Number(taskMatch[1]),
              taskId: Number(taskMatch[2]),
              title: 'Loading...',
            });
            view.dispatch(tr.replaceSelectionWith(node));
            fetchTaskInfo(view, Number(taskMatch[1]), Number(taskMatch[2]));
            return true;
          }

          // doc 경로
          const docMatch = pathname.match(DOC_PATH);
          if (docMatch && schema.nodes.docRef) {
            event.preventDefault();
            const node = schema.nodes.docRef.create({
              canvasId: Number(docMatch[1]),
              pageId: Number(docMatch[2]),
              title: 'Loading...',
            });
            view.dispatch(tr.replaceSelectionWith(node));
            fetchDocInfo(view, Number(docMatch[1]), Number(docMatch[2]));
            return true;
          }
        }

        // bookmark 노드가 없는 에디터(댓글·태스크설명 등)는 외부 URL을 일반 텍스트로 통과
        if (!view.state.schema.nodes.bookmark) return false;

        // 외부 URL → bookmark 카드
        event.preventDefault();

        let domain = '';
        try { domain = new URL(text).hostname; } catch { domain = text; }

        const { schema, tr } = view.state;
        const bookmarkNode = schema.nodes.bookmark.create({
          url: text,
          title: text,
          domain,
          loading: true,
        });
        view.dispatch(tr.replaceSelectionWith(bookmarkNode));

        fetchAndUpdate(view, text);
        return true;
      },
    },
  });
}

// 에디터들이 공용으로 쓰는 TipTap Extension 래퍼.
// 각 에디터 스키마에 있는 ref/bookmark 노드만 변환되고 나머지는 통과한다.
export const BookmarkPasteExtension = Extension.create({
  name: 'bookmarkPaste',
  addProseMirrorPlugins() {
    return [createBookmarkPastePlugin()];
  },
});

// 내부 ref 정보 fetch 후 노드 속성 업데이트
async function fetchTaskInfo(view, branchId, taskId) {
  try {
    const res = await axios.get(`/branches/${branchId}/tasks/${taskId}`);
    if (res.data.status && res.data.task) {
      const task = res.data.task;
      updateRefNode(view, 'taskRef', { taskId }, {
        displayId: task.display_id || '',
        title: task.title || '',
        status: task.status || 'todo',
        priority: task.priority || 'medium',
        statusLabel: task.status_label || null,
        statusColor: task.status_color || null,
        statusCategory: task.status_category || null,
      });
    }
  } catch {}
}

async function fetchIssueInfo(view, branchId, taskId, issueId) {
  try {
    const res = await axios.get(`/branches/${branchId}/tasks/${taskId}/issues/${issueId}`);
    if (res.data.status && res.data.issue) {
      const issue = res.data.issue;
      updateRefNode(view, 'issueRef', { issueId }, {
        displayId: issue.display_id || '',
        title: issue.title || '',
        status: issue.status || 'open',
      });
    }
  } catch {}
}

async function fetchDocInfo(view, canvasId, pageId) {
  try {
    const res = await axios.get(`/canvases/${canvasId}/pages/${pageId}`);
    if (res.data.status && res.data.page) {
      const page = res.data.page;
      updateRefNode(view, 'docRef', { pageId }, {
        title: page.title || '',
        canvasName: page.canvas_name || '',
      });
    }
  } catch {}
}

// 특정 타입 + 속성 조건으로 ref 노드를 찾아서 속성 업데이트
function updateRefNode(view, typeName, matchAttrs, newAttrs) {
  const { doc, tr } = view.state;

  doc.descendants((node, pos) => {
    if (node.type.name !== typeName) return;
    // matchAttrs의 모든 키가 일치하는 노드 찾기
    const isMatch = Object.entries(matchAttrs).every(
      ([key, val]) => node.attrs[key] === val
    );
    if (!isMatch) return;
    // title이 'Loading...'인 노드만 업데이트 (중복 방지)
    if (node.attrs.title !== 'Loading...') return;

    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...newAttrs });
    return false;
  });

  if (tr.docChanged) {
    view.dispatch(tr);
  }
}

// 외부 URL 메타데이터 fetch
async function fetchAndUpdate(view, url) {
  try {
    const res = await axios.post('/url-meta', { url });

    if (res.data.status && res.data.meta) {
      const meta = res.data.meta;
      updateBookmarkNode(view, url, {
        title: meta.title || url,
        description: meta.description || '',
        favicon: meta.favicon || '',
        ogImage: meta.og_image || '',
        domain: meta.domain || '',
        loading: false,
      });
    } else {
      updateBookmarkNode(view, url, { loading: false });
    }
  } catch {
    updateBookmarkNode(view, url, { loading: false });
  }
}

function updateBookmarkNode(view, url, newAttrs) {
  const { doc, tr } = view.state;

  doc.descendants((node, pos) => {
    if (node.type.name === 'bookmark' && node.attrs.url === url && node.attrs.loading) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...newAttrs });
      return false;
    }
  });

  if (tr.docChanged) {
    view.dispatch(tr);
  }
}

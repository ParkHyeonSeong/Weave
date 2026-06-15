// ```(트리플 백틱) 짝이 안 맞으면(홀수) 코드 작성 중
export function isCodeMode(text) {
  return ((text || '').match(/```/g) || []).length % 2 === 1;
}

// 작성부 입력에서 슬래시 명령 상태 파싱
// returns { kind:'menu' } | { kind:'command', type, mode?, keyword } | { kind:'none' }
export function parseSlashInput(val) {
  if (val === '/') return { kind: 'menu' };
  if (val.match(/^\/ta\s/)) return { kind: 'command', type: 'task', mode: 'all', keyword: val.slice(4) };
  if (val.match(/^\/t\s/)) return { kind: 'command', type: 'task', mode: 'my', keyword: val.slice(3) };
  if (val.match(/^\/d\s/)) return { kind: 'command', type: 'doc', keyword: val.slice(3) };
  if (val.match(/^\/i\s/)) return { kind: 'command', type: 'issue', keyword: val.slice(3) };
  if (val.match(/^\/[tdia]?$/) || val.match(/^\/ta?$/)) return { kind: 'menu' };
  return { kind: 'none' };
}

// pendingFiles → onSubmit attachments. done(url)→uploaded:true, ready(file)→uploaded:false. uploading 제외.
export function buildAttachmentsPayload(pendingFiles) {
  return pendingFiles
    .filter((f) => f.status === 'done' || f.status === 'ready')
    .map((f) =>
      f.status === 'done'
        ? { uploaded: true, url: f.url, file_name: f.file_name, file_type: f.file_type, file_size: f.file_size }
        : { uploaded: false, file: f.file, file_name: f.file_name, file_type: f.file_type, file_size: f.file_size }
    );
}

// composer payload + 최종 첨부(업로드된 url 배열)로 WS send_message 객체 구성
export function buildSendMessage(roomId, payload, attachments) {
  const ws = { action: 'send_message', room_id: roomId, content: payload.content };
  if (payload.taskId) ws.task_id = payload.taskId;
  if (payload.canvasPageId) ws.canvas_page_id = payload.canvasPageId;
  if (payload.issueId) ws.issue_id = payload.issueId;
  if (payload.mentionedUserIds.length > 0) ws.mentioned_user_ids = payload.mentionedUserIds;
  if (attachments.length > 0) ws.attachments = attachments;
  return ws;
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

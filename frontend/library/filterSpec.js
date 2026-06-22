// frontend/library/filterSpec.js
/** FilterSpec 클라이언트 평가기. backend/core/query/eval_inmem.py와 의미 일치(parity 픽스처로 강제). */
const DATE_FIELDS = new Set(['due_date', 'start_date', 'created_at', 'updated_at']);
const LEAF = { status: 'status', status_category: 'status_category', priority: 'priority',
  task_type: 'task_type', epic: 'epic_id', sprint: 'sprint_id', created_by: 'created_by',
  due_date: 'due_date', start_date: 'start_date', created_at: 'created_at', updated_at: 'updated_at' };

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function resolve(value, ctx, isDate) {
  if (value === '$me') return ctx.userId;
  if (isDate && typeof value === 'string') {
    if (value === '$today') return ctx.today;
    // grammar는 filter_spec._DATE_TOKEN / eval_inmem._REL과 동기
    const m = /^\$today([+-]\d+)d$/.exec(value);
    if (m) return addDays(ctx.today, parseInt(m[1], 10));
  }
  return value;
}
function cmp(a, op, b) {
  if (a == null) return false;
  if (op === 'eq') return a === b;
  if (op === 'lt') return a < b;
  if (op === 'lte') return a <= b;
  if (op === 'gt') return a > b;
  if (op === 'gte') return a >= b;
  return false;
}
const strip = (s) => (s || '').replace(/<[^>]+>/g, ' ');

function cfText(raw) {
  // custom_fields raw → 비교용 텍스트(Py _cf_text와 1:1). bool 소문자, null은 비매칭.
  // 소수(1.0)는 JS가 int/float 구분이 없어 Py와 표기차가 남음 — v1 cf는 text/select 위주.
  if (raw == null) return null;
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  return String(raw);
}

function evalCond(task, node, ctx) {
  const { field, op, value } = node;
  if (field === 'assignee') {
    if (op === 'is_empty') return (task.assignees || []).length === 0;
    const ids = (op === 'in' ? value : [value]).map((v) => (v === '$me' ? ctx.userId : v));
    return (task.assignees || []).some((a) => ids.includes(a.user_id));
  }
  if (field === 'label') {
    if (op === 'is_empty') return (task.labels || []).length === 0;
    const set = new Set(value);
    return (task.labels || []).some((l) => set.has(l.label_id));
  }
  if (field === 'has_subtasks') {
    const has = (task.subtaskCount || (task.subtasks || []).length) > 0;
    return value ? has : !has;
  }
  if (field === 'is_top_level') {
    const top = task.parent_task_id == null;
    return value ? top : !top;
  }
  if (field === 'text') {
    const hay = `${task.title || ''} ${strip(task.description)}`.toLowerCase();
    return op === 'eq' ? hay.trim() === String(value).toLowerCase() : hay.includes(String(value).toLowerCase());
  }
  if (field.startsWith('cf:')) {
    const raw = cfText((task.custom_fields || {})[field.slice(3)]);
    if (op === 'is_empty') return raw == null;
    if (raw == null) return false;
    if (op === 'contains') return raw.toLowerCase().includes(String(value).toLowerCase());
    if (op === 'in') return value.map(String).includes(raw);
    // eq (v1: cf 비교 op 없음)
    return raw === String(value);
  }
  const col = LEAF[field];
  const isDate = DATE_FIELDS.has(field);
  const lv = task[col];
  if (op === 'is_empty') return lv == null;
  if (op === 'in') return value.map((v) => resolve(v, ctx, isDate)).includes(lv);
  if (op === 'between') return lv != null && lv >= resolve(value[0], ctx, isDate) && lv <= resolve(value[1], ctx, isDate);
  return cmp(lv, op, resolve(value, ctx, isDate));
}

export function evaluate(task, node, ctx = {}) {
  if (!node) return true;
  let res;
  if (node.type === 'group') {
    const ch = node.children || [];
    if (ch.length === 0) res = true;
    else if (node.op === 'OR') res = ch.some((x) => evaluate(task, x, ctx));
    else res = ch.every((x) => evaluate(task, x, ctx));
  } else {
    res = evalCond(task, node, ctx);
  }
  return node.negate ? !res : res;
}

// Mermaid 런타임 — 테마별 initialize + 렌더 직렬화.
// `initialized` 불리언이 최초 1회만 initialize()를 실행해 테마 토글이 영원히 도달하지 못했다.
// render()는 테마 인자를 받지 않고 렌더 시점의 전역 config를 읽으므로 "initialize(theme) →
// render()"를 원자화해야 한다. 직렬화는 library/mermaidRenderQueue.js가 담당한다.

import { createMermaidRenderQueue } from '@/library/mermaidRenderQueue';

// mermaid 11.15.0은 12개 테마 이름을 받지만(config.type.d.ts:69) 우리는 기본 2개만 쓴다.
const THEME_BY_RESOLVED = { light: 'default', dark: 'dark' };

export function mermaidThemeFor(resolved) {
  return THEME_BY_RESOLVED[resolved] || THEME_BY_RESOLVED.light;
}

let mermaidModule = null;
let loadingPromise = null;

async function loadMermaid() {   // lazy import — 초기 번들 크기 영향 최소화
  if (mermaidModule) return mermaidModule;
  if (!loadingPromise) {
    loadingPromise = import('mermaid').then((mod) => { mermaidModule = mod.default || mod; return mermaidModule; });
  }
  return loadingPromise;
}

const queue = createMermaidRenderQueue({
  initialize: async (theme) => {
    const mermaid = await loadMermaid();
    // ⚠️ securityLevel을 낮추지 마라('loose'/'antiscript'는 문서에 스크립트를 넣게 한다).
    //    나머지 옵션은 이전 구조에서 바이트 그대로 — theme만 인자화됐다.
    mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict', fontFamily: 'inherit' });
  },
  render: async (id, text) => {
    const mermaid = await loadMermaid();
    // parse는 initialize와 같은 태스크 안에서 돌려 config 일관성을 보장한다.
    const valid = await mermaid.parse(text, { suppressErrors: true });
    if (valid === false) return { ok: false, reason: 'invalid-syntax' };
    const { svg } = await mermaid.render(id, text);
    return { ok: true, svg };
  },
});

/**
 * @param {() => 'light'|'dark'} getResolved  실행 시점의 최신 테마를 읽는 함수
 * @param {string} id    nextMermaidId()
 * @param {string} text  mermaid DSL
 * @returns {Promise<{ok: true, svg: string} | {ok: false, reason: string}>}
 */
export function renderMermaid(getResolved, id, text) {
  return queue.enqueue(() => mermaidThemeFor(getResolved()), id, text);
}

// 테스트·디버그용 — 현재 전역 config에 적용된 mermaid 테마
export function appliedMermaidTheme() { return queue.appliedTheme(); }

let idCounter = 0;   // 고유 ID 생성기 (mermaid.render는 고유 id를 요구)
export function nextMermaidId() {
  idCounter += 1;
  return `mermaid-svg-${Date.now()}-${idCounter}`;
}

// Mermaid 런타임 초기화 싱글톤
// 런타임에 한 번만 mermaid.initialize()를 호출하여 여러 에디터/블록에서 공유한다.
// lazy import로 초기 번들 크기 영향을 최소화한다.

let mermaidModule = null;
let initialized = false;
let loadingPromise = null;

export async function getMermaid() {
  if (mermaidModule && initialized) return mermaidModule;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const mod = await import('mermaid');
    const mermaid = mod.default || mod;
    if (!initialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'strict',
        fontFamily: 'inherit',
      });
      initialized = true;
    }
    mermaidModule = mermaid;
    return mermaid;
  })();

  return loadingPromise;
}

// 고유 ID 생성기 (mermaid.render는 고유 id를 요구)
let idCounter = 0;
export function nextMermaidId() {
  idCounter += 1;
  return `mermaid-svg-${Date.now()}-${idCounter}`;
}

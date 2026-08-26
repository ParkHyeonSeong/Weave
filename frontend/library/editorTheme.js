// CodeMirror 6 테마 배선.
//
// @codemirror/* 를 여기서 import 하지 않는다 — (1) 두 소비처가 CM을 동적 import 하므로
// 정적 참조하면 초기 번들에 CM이 통째로 딸려 오고, (2) vitest environment: 'node'에서
// 그대로 단위 테스트하려면 모듈 객체를 주입받아야 한다.
//
// Compartment인 이유: 생성 effect deps에 resolved를 넣으면 에디터가 재생성돼
// RawMarkdownEditor는 편집 내용이 초기값으로 리셋되고(initialValueRef uncontrolled),
// TypstEditor는 yCollab·patchYSync가 재생성돼 협업 커서·awareness·undo가 소실된다.
// reconfigure는 문서 상태를 그대로 두고 확장만 갈아끼운다.
//
// getResolved가 "값"이 아니라 "함수"인 이유: 두 생성 경로 모두 await 뒤에 실행된다
// (loadCmModules, 그리고 TypstEditor는 provider.once('sync') 무한 대기).
// 클로저로 캡처하면 마운트 시점 값에 영구 고정되므로 생성 시점에 최신값을 읽는다.

/**
 * @param {'light'|'dark'|unknown} resolved  useTheme().resolved
 * @param {{oneDark?: unknown, oneDarkTheme?: unknown}|null} cmOneDark  @codemirror/theme-one-dark 모듈 객체
 * @param {'full'|'chrome'} variant  'full'=oneDark(테마+구문색, TypstEditor) /
 *   'chrome'=oneDarkTheme만(RawMarkdownEditor — 라이트에 syntaxHighlighting이 없어서
 *   'full'을 쓰면 다크에서만 구문색이 생기는 비대칭이 된다)
 * @returns {unknown[]}
 */
export function themeExtensionFor(resolved, cmOneDark, variant = 'full') {
  if (resolved !== 'dark') return [];
  if (!cmOneDark) return [];
  const ext = variant === 'chrome' ? cmOneDark.oneDarkTheme : cmOneDark.oneDark;
  return ext ? [ext] : [];
}

/**
 * @param {object} deps
 * @param {new () => {of: Function, reconfigure: Function}} deps.Compartment  @codemirror/state 의 Compartment
 * @param {() => unknown} deps.getResolved   호출 시점의 최신 resolved
 * @param {() => unknown} deps.getOneDark    호출 시점의 theme-one-dark 모듈(미로드면 falsy)
 * @param {'full'|'chrome'} [deps.variant]
 */
export function createThemeBinding({ Compartment, getResolved, getOneDark, variant = 'full' }) {
  const compartment = new Compartment();
  const ext = () => themeExtensionFor(getResolved(), getOneDark(), variant);
  return {
    compartment,
    /** EditorState.create의 extensions 배열에 넣는다. 반드시 **뷰 생성 직전에** 호출한다. */
    initial: () => compartment.of(ext()),
    /** view.dispatch({ effects: binding.reconfigure() }) */
    reconfigure: () => compartment.reconfigure(ext()),
  };
}

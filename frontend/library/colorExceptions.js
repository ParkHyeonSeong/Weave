// 색 리터럴 예외 레지스트리 — 다크모드 스윕의 **정본**.
//
// "리터럴 0건"을 목표로 삼지 않는다. 모든 색 출현이 정확히 하나의 분류를 갖고, 분류가 조치를
// 결정한다. theme-dependent가 **아닌** 것만 여기 등록한다.
// 분류 8종의 뜻·판별 규칙·항목 shape의 정본 정의는 계획 index 「색 분류 8종」에 있다. 여기서는 요약만 둔다:
//
//   file      frontend/ 기준 상대경로 ('frontend/' 접두·절대경로 금지)
//   selector  CSS/SCSS면 **컴파일된 CSS를 postcss로 파싱한** 셀렉터(그룹 셀렉터는 원문 그대로).
//             JS/JSX/HTML/JSON/SVG면 null.
//   prop      CSS면 선언 property. 비-CSS면 값 바로 앞의 최근접 식별자.
//   value     소스에 적힌 바이트 그대로. 정규화·대소문자 변환 금지.
//   category  COLOR_CATEGORIES 8종 중 하나. **theme-dependent는 등록할 수 없다.**
//   reason    **20자 이상.** "왜 토큰을 쓸 수 없는가". "고정색이라서" 같은 동어반복 금지.
//
// S5가 생성 → S6~S8이 자기 구획에 append → S9의 literalColorSweep이 consume-once 튜플 매칭으로
// 소비한다. 미소비 예외가 남아도 RED다(죽은 예외) — 리터럴을 지웠으면 여기서도 지워라.
// ⚠️ 튜플 유일성을 단정하지 않는다. 같은 튜플이 소스에 N번 나오면 여기도 N개다(= 소비 예산).

export const COLOR_CATEGORIES = [
  'theme-dependent',
  'fixed-on-color',
  'overlay-scrim',
  'print-paper',
  'palette-source',
  'stored-color',
  'third-party',
  'dead',
];

export const COLOR_EXCEPTIONS = [
  // ── S5 (sweep A: common/layout/home/branch/modal) ──────────────────────────
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__Backdrop', prop: 'background', value: 'rgba(0, 0, 0, 0.85)',
    category: 'overlay-scrim',
    reason: '임의 이미지 위에 덮는 스크림이다. 다크에서 밝히면 사진 감상용 암전이 깨지고 라이트에서도 같은 값이 옳다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__Zoombar', prop: 'background', value: 'rgba(0, 0, 0, 0.5)',
    category: 'overlay-scrim',
    reason: '스크림 위에 뜨는 줌 컨트롤 바다. 배경이 앱 표면이 아니라 암전된 이미지라 표면 토큰을 쓰면 대비가 무너진다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__Topbar', prop: 'color', value: '#fff',
    category: 'fixed-on-color',
    reason: '0.85 알파 검은 스크림 위 텍스트다. 배경이 테마와 무관하게 고정이므로 텍스트도 고정 흰색이 정답이다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__Error', prop: 'color', value: '#fff',
    category: 'fixed-on-color',
    reason: '검은 스크림 위 오류 문구다. 앱 표면 토큰을 쓰면 다크에서 회색이 되어 스크림 위에서 읽히지 않는다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__IconBtn, .Lightbox__ZoomBtn', prop: 'background', value: 'rgba(255, 255, 255, 0.12)',
    category: 'fixed-on-color',
    reason: '검은 스크림 위 컨트롤 배경이다. 흰색 알파가 스크림을 살짝 들어올리는 값이라 표면 토큰으로 대체 불가능하다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__IconBtn, .Lightbox__ZoomBtn', prop: 'color', value: '#fff',
    category: 'fixed-on-color',
    reason: '검은 스크림 위 컨트롤 아이콘 색이다. 배경이 테마 무관 고정이므로 대비색도 고정이어야 한다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__IconBtn:hover, .Lightbox__ZoomBtn:hover', prop: 'background', value: 'rgba(255, 255, 255, 0.24)',
    category: 'fixed-on-color',
    reason: '스크림 위 컨트롤의 hover 강조다. 기본값과 같은 흰색 알파 사다리를 유지해야 hover가 구분된다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__Nav', prop: 'background', value: 'rgba(255, 255, 255, 0.12)',
    category: 'fixed-on-color',
    reason: '스크림 위 좌우 이동 버튼 배경이다. 앱 표면이 아니라 암전된 이미지 위라 표면 토큰이 의미를 갖지 않는다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__Nav', prop: 'color', value: '#fff',
    category: 'fixed-on-color',
    reason: '스크림 위 이동 버튼 아이콘이다. 배경이 고정 흰알파라 아이콘도 고정 흰색이어야 대비가 유지된다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__Nav:hover', prop: 'background', value: 'rgba(255, 255, 255, 0.24)',
    category: 'fixed-on-color',
    reason: '스크림 위 이동 버튼 hover다. 기본 0.12과의 대비 차로 상태를 표현하므로 같은 축의 값이어야 한다.',
  },
  {
    file: 'styles/components/common/avatar.scss',
    selector: '.Avatar', prop: 'color', value: '#fff',
    category: 'fixed-on-color',
    reason: '배경이 library/userAvatar.js의 12색 팔레트를 JS 인라인 style로 칠한 고정색이다. 테마와 무관해 이니셜은 흰색이 정답이다.',
  },
  {
    file: 'styles/components/common/labelTagInput.scss',
    selector: '.LabelTagInput__OptionDot:hover', prop: 'border-color', value: 'rgba(0, 0, 0, 0.15)',
    category: 'fixed-on-color',
    reason: '스와치 자체가 프리셋 16색 또는 사용자 저장색이다. 임의 색 위 hover 윤곽이라 표면 토큰을 쓰면 밝은 스와치에서 사라진다.',
  },

  // --- S6: canvas ---
  { file: 'styles/components/canvas/typstEditor.scss', selector: '.TypstEditor__Page', prop: 'background', value: '#fff', category: 'print-paper',
    reason: 'Typst 미리보기는 종이를 모사한다. 스펙 2026-07-13-dark-mode-design.md:163이 다크에서도 흰 종이 유지를 의도적 예외로 명시했다.' },
  { file: 'styles/components/canvas/typstEditor.scss', selector: '.CanvasPageView__TypstPage', prop: 'background', value: '#fff', category: 'print-paper',
    reason: '읽기 모드의 Typst 렌더도 같은 종이 모사다. 검정 글리프가 흰 종이 위에 있어야 원본 조판과 동일하다.' },
  // selector는 컴파일 실측값이다. 원문 :127이 .TypstEditor__Code 안에 중첩돼 있어
  // '.yRemoteSelectionHead::after'로 쓰면 Step 4 대조가 어긋난다.
  { file: 'styles/components/canvas/typstEditor.scss', selector: '.TypstEditor__Code .yRemoteSelectionHead::after', prop: 'color', value: '#fff', category: 'fixed-on-color',
    reason: 'background가 inherit로 협업자 커서 색을 받는다. 배경이 임의 사용자 색이라 테마 토큰으로 대체할 수 없다.' },
  { file: 'styles/components/canvas/canvasCollabEditor.scss', selector: '.collaboration-cursor__avatar', prop: 'color', value: 'white', category: 'fixed-on-color',
    reason: 'buildAvatarDOM이 세팅하는 AVATAR_COLORS 12색은 library/userAvatar.js:6 주석대로 흰 텍스트 4.5:1 기준으로 선정됐다. 테마와 무관하게 흰색이 옳다.' },
  { file: 'styles/components/canvas/typstEditor.scss', selector: '.TypstEditor__Page', prop: 'box-shadow', value: 'rgba(0, 0, 0, 0.08)', category: 'overlay-scrim',
    reason: 'print-paper로 고정한 흰 종이를 배경에서 띄우는 그림자다. 아래 표면이 테마 토큰이 아니라 고정 흰색이라 --shadow-* 로 옮기면 다크에서 그림자만 짙어져 종이 가장자리가 탁해진다.' },
  { file: 'styles/components/canvas/typstEditor.scss', selector: '.CanvasPageView__TypstPage', prop: 'box-shadow', value: 'rgba(0, 0, 0, 0.08)', category: 'overlay-scrim',
    reason: '읽기 모드 종이도 같은 흰 종이 분리 그림자다. 종이가 테마 불변이므로 그 아래 그림자도 같은 검정 알파로 고정해야 편집/읽기 모드가 같아 보인다.' },
  // selector에 ' | ' 구분자와 @media 프리픽스가 들어간다 — hitsFor의 selectorPath()가 내는 형식 그대로다.
  // '.AnnotationSidebar::before'만 쓰면 MISSING_EXCEPTION + DEAD_EXCEPTION이 동시에 난다.
  { file: 'styles/components/canvas/annotation.scss', selector: '@media (min-width: 768px) and (max-width: 1439px) | .AnnotationSidebar::before', prop: 'background', value: 'rgba(0, 0, 0, 0.32)', category: 'overlay-scrim',
    reason: '주석 사이드바 뒤 본문 전체를 덮는 딤이다. 아래가 임의 문서 콘텐츠(이미지 포함)라 표면 토큰을 쓰면 다크에서 딤이 밝아져 본문이 물러나지 않는다.' },

  // --- S6: profile ---
  { file: 'styles/components/profile/profile.scss', selector: '.Profile__ColorSwatch', prop: 'box-shadow', value: 'rgba(0, 0, 0, 0.06)', category: 'fixed-on-color',
    reason: '스와치 배경은 Profile.js:317의 style={{ background: c }}로 칠하는 AVATAR_COLORS 팔레트색이다. 밝은 스와치의 경계를 잡는 inset 링이라 테마 불변이다.' },
  { file: 'styles/components/profile/profile.scss', selector: '.Profile__ColorSwatch--selected', prop: 'border-color', value: '#fff', category: 'fixed-on-color',
    reason: '선택 표시 링이 팔레트색 스와치 위에 직접 얹힌다. 배경이 임의 preset 색이라 테마 토큰으로 바꾸면 밝은 스와치에서 링이 사라진다.' },
  { file: 'styles/components/profile/profile.scss', selector: '.Profile__AvatarOverlay', prop: 'background', value: 'rgba(0, 0, 0, 0.4)', category: 'overlay-scrim',
    reason: '업로드한 임의 아바타 이미지 위를 덮는 hover 스크림이다. 다크에서도 어두워야 그 위 흰 카메라 아이콘·문구가 읽힌다.' },
  { file: 'styles/components/profile/profile.scss', selector: '.Profile__AvatarOverlay', prop: 'color', value: '#fff', category: 'fixed-on-color',
    reason: '바로 위 rgba(0, 0, 0, 0.4) 스크림 위에 얹히는 카메라 아이콘 색이다. 배경이 코드 고정 검정 막이라 테마와 무관하게 흰색이 옳다.' },
  { file: 'styles/components/profile/profile.scss', selector: '.Profile__AvatarSpinner', prop: 'border', value: 'rgba(255, 255, 255, 0.3)', category: 'fixed-on-color',
    reason: '업로드 중 같은 검정 스크림 위에서 도는 스피너 트랙이다. 스크림 기준 대비색이라 앱 표면 토큰과 무관하다.' },
  { file: 'styles/components/profile/profile.scss', selector: '.Profile__AvatarSpinner', prop: 'border-top-color', value: '#fff', category: 'fixed-on-color',
    reason: '스피너의 진행 호도 검정 스크림 위에 있다. 스크림이 테마 불변이므로 흰색 고정이 정답이다.' },

  // --- S6: track (S4가 인라인 주석으로 남긴 예외를 레지스트리로 이관) ---
  { file: 'styles/components/track/track.scss', selector: '.TrackHeader__WeaveSeg', prop: 'color', value: 'rgba(255, 255, 255, 0.96)', category: 'fixed-on-color',
    reason: '브랜치 런타임 데이터색이 배경이라 테마와 무관하게 흰 글자가 옳다. S4 인라인 주석 [S4:T201]을 그대로 이관했다. 동적 on-color 접근성 부채는 S7.' },
  { file: 'styles/components/track/track.scss', selector: '.TrackHeader__WeaveSeg + .TrackHeader__WeaveSeg', prop: 'box-shadow', value: 'rgba(255, 255, 255, 0.18)', category: 'fixed-on-color',
    reason: '세그먼트 구분선이 브랜치 런타임 데이터색 배경 위에 inset으로 그려진다. [S4:T201]과 같은 표면이라 테마 불변이다.' },
  { file: 'styles/components/track/track.scss', selector: '.TrackHeader__WeaveSegCount', prop: 'background', value: 'rgba(0, 0, 0, 0.18)', category: 'fixed-on-color',
    reason: '카운트 알약이 브랜치 런타임 데이터색 위를 눌러 대비를 만든다. 배경이 임의 데이터색이라 테마 토큰으로 대체할 수 없다.' },
  { file: 'styles/components/track/track.scss', selector: '.ManageBranches__Mark', prop: 'color', value: '#FFFFFF', category: 'fixed-on-color',
    reason: '체크 마크가 브랜치 런타임 데이터색 배경 위에 얹힌다. S4 인라인 주석 [S4:T2399]를 이관했다.' },
  { file: 'styles/components/track/tracksIndex.scss', selector: '.CreateTrack__Color', prop: 'color', value: '#FFFFFF', category: 'fixed-on-color',
    reason: '고정 preset accent 배경 위 체크 표시라 테마 불변이다. S4 인라인 주석 [S4:X147]을 이관했다.' },
  { file: 'styles/components/track/tracksIndex.scss', selector: '.CreateTrack__BranchMark', prop: 'color', value: '#FFFFFF', category: 'fixed-on-color',
    reason: '런타임 데이터색 배경 위 아이콘이라 테마 불변이다. S4 인라인 주석 [S4:X228]을 이관했다.' },

  // --- S6: dead 3건 (globe·next는 S9 소유 — 여기 적지 마라) ---
  // 삭제는 S9 백로그(SW 캐시·manifest와 함께 판단). fill="none"은 named color가 아니라 hit이 아니다.
  { file: 'public/file.svg', selector: null, prop: 'fill', value: '#666', category: 'dead',
    reason: 'Next.js 스캐폴딩 잔재로 앱 참조가 0건이다. 자산 삭제는 sw.js 프리캐시·manifest와 함께 판단해야 해서 S9로 넘긴다.' },
  { file: 'public/vercel.svg', selector: null, prop: 'fill', value: '#fff', category: 'dead',
    reason: 'Next.js 스캐폴딩 잔재로 앱 참조가 0건이다. 자산 삭제는 sw.js 프리캐시·manifest와 함께 판단해야 해서 S9로 넘긴다.' },
  { file: 'public/window.svg', selector: null, prop: 'fill', value: '#666', category: 'dead',
    reason: 'Next.js 스캐폴딩 잔재로 앱 참조가 0건이다. 자산 삭제는 sw.js 프리캐시·manifest와 함께 판단해야 해서 S9로 넘긴다.' },
];

export function findException(file, selector, prop, value) {
  return COLOR_EXCEPTIONS.find(
    (e) => e.file === file && e.selector === selector && e.prop === prop && e.value === value,
  );
}

// ── S8: 서드파티 소유 색 ──────────────────────────────────────────────────
// COLOR_EXCEPTIONS(튜플 소비-1회 매칭)와 다른 축이다. 이 파일들의 색은 우리 소스에 한 글자도
// 없고 컴파일/런타임에 node_modules의 라이브러리 테마가 주입한다. 튜플로 열거하면
// 라이브러리 패치 버전이 오를 때마다 게이트가 깨지는데, 그 깨짐은 "우리 코드에 리터럴이
// 생겼다"는 신호가 아니라 소음이다.
//
// ⚠️ S9 계약: 아래 file 중 **styles/vendor/ 아래 경로와 node_modules/ 경로만** 리터럴 스윕
//    대상에서 제외한다. 나머지 항목은 **문서 기록 전용**이며 스윕 대상에서 빠지지 않는다
//    (그 파일들의 리터럴 수가 0이므로 제외가 필요 없고, 제외하면 나중에 생기는 진짜
//    리터럴을 놓친다).
export const THIRD_PARTY_OWNED = [
  {
    file: 'styles/vendor/highlight-themes.scss',
    category: 'third-party',
    owner: 'highlight.js@11.11.1 styles/github.min.css + styles/github-dark.min.css',
    mechanism: "sass meta.load-css 컴파일 타임 인라인. 다크는 html[data-theme='dark'] 스코프",
    reason: '코드 구문 하이라이트 팔레트 전체를 라이브러리가 소유한다. 소스에는 파일 경로만 있고 색 리터럴이 0건이라 우리가 토큰으로 옮길 대상이 존재하지 않는다.',
  },
  {
    file: 'library/editorTheme.js',
    category: 'third-party',
    // 소유권이 갈리는 유일한 항목이라 **두 소비 경로를 나눠** 실측 그대로 적는다.
    //
    // ① TypstEditor — variant 'full' = oneDarkTheme + syntaxHighlighting(oneDarkHighlightStyle)
    //    앱이 덮는 것(typstEditor.scss, .TypstEditor__Code 하위):
    //      .cm-editor background($color-surface) · .cm-gutters 전경/배경/보더 ·
    //      .cm-activeLine · .cm-activeLineGutter · .cm-selectionBackground(선택 레이어)
    //
    // ② RawMarkdownEditor — variant 'chrome' = oneDarkTheme **만**(syntaxHighlighting 미사용)
    //    → 이 표면에는 oneDark 구문 팔레트가 **아예 없다**(라이트와 대칭 유지가 목적).
    //    앱이 덮는 것(rawMarkdownEditor.scss, .RawMarkdownEditor 하위):
    //      .cm-editor background($color-bg) · .cm-placeholder 전경($color-text-tertiary)
    //
    // ⚠️ 캐럿은 **두 경로 모두 oneDarkTheme 소유다.** 두 편집기가 똑같이
    //    cmView.drawSelection() + cmView.dropCursor()를 설치한다. drawSelection은 Prec.highest
    //    테마로 `.cm-content { caret-color: transparent !important }`를 걸어 **네이티브 캐럿을
    //    숨기고** .cm-cursor를 렌더하고, dropCursor는 별도로 .cm-dropCursor를 렌더한다.
    //    다크에서 두 엘리먼트의 border-left-color를 정하는 것은 oneDarkTheme다.
    // ⚠️ dormant 선언 1건: rawMarkdownEditor.scss에 `.cm-content { caret-color: $color-text; }`가
    //    **존재하지만** 위 transparent !important(Prec.highest)에 가려 실제 보이는 캐럿을
    //    소유하지 않는다. 선언은 남아 있으므로 기록만 하고, 소유권 주장에 쓰지 않는다.
    // ⚠️ "selection을 앱이 소유한다"고 쓰지 않는다 — Typst에서 앱이 덮는 것은 **선택 레이어**
    //    (.cm-selectionBackground)뿐이고 oneDark의 .cm-content ::selection은 그대로 남는다.
    owner: '@codemirror/theme-one-dark@6.1.3 — full(Typst)에서는 구문 팔레트까지, chrome(RawMarkdown)에서는 '
      + 'oneDarkTheme만. 두 경로 공통으로 drawSelection과 dropCursor가 각각 그리는 .cm-cursor와 '
      + '.cm-dropCursor · dark facet · '
      + '기본 전경 · 네이티브 ::selection · 패널 · 검색/매치 · fold placeholder · 툴팁 등 '
      + '앱이 덮지 않은 CodeMirror 다크 UI 색 전부',
    mechanism: "Compartment로 확장 주입. variant 'full'(TypstEditor)=oneDark(테마+구문색) / "
      + "'chrome'(RawMarkdownEditor)=oneDarkTheme만. 앱이 덮는 chrome은 경로마다 다르다 — "
      + 'typstEditor.scss는 .cm-editor background·gutter 전경/배경/보더·activeLine·activeLineGutter·'
      + 'selection layer를, rawMarkdownEditor.scss는 .cm-editor background·.cm-placeholder 전경을 덮는다. '
      + 'rawMarkdownEditor.scss의 .cm-content caret-color는 drawSelection의 Prec.highest '
      + 'transparent !important에 가려지는 dormant 선언이라 소유권에 포함하지 않는다',
    reason: 'CodeMirror 다크 UI 색의 대부분을 공식 다크 테마가 소유해 우리 소스에 색 리터럴이 없다. 앱은 두 소비 경로에서 서로 다른 chrome 일부만 토큰으로 덮는데, Typst 배경을 덮는 이유는 oneDark 기본 배경 위에서 같은 팔레트의 stone·coral이 4.5:1 대비 게이트를 통과하지 못하기 때문이다.',
  },
  {
    file: 'components/Canvas/extensions/mermaidConfig.js',
    category: 'third-party',
    owner: "mermaid@11.15.0 내장 테마 ('default' / 'dark')",
    mechanism: 'initialize({theme}) 전역 config. 렌더 SVG의 색은 mermaid가 생성한다',
    reason: '다이어그램 노드·엣지·라벨 색을 mermaid 테마가 소유한다. 우리는 테마 이름 문자열만 넘긴다.',
  },
  {
    file: 'components/common/IconPicker.js',
    category: 'third-party',
    owner: 'emoji-picker-react@4.19.1 (epr-dark-theme)',
    mechanism: 'theme prop → 런타임 CSS 주입(.epr-dark-theme)',
    reason: '이모지 피커의 색은 라이브러리가 런타임에 스타일시트를 주입해 만든다. grep 스윕에 잡히지 않으므로 소유권만 기록한다.',
  },
  {
    file: 'node_modules/katex/dist/katex.min.css',
    category: 'third-party',
    owner: 'katex@0.16.35',
    mechanism: 'currentColor 상속 — 우리 코드 변경 0줄',
    reason: '색 선언이 .katex *{border-color:currentColor} / .katex svg{fill,stroke:currentColor} / .katex svg path{stroke:none} 3건뿐이고 고정 hex·rgb가 0건이다. 스펙이 불필요한 오버라이드를 금지한다.',
  },
];

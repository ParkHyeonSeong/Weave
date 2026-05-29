// 앱 컨텍스트 공용 유틸. 현재는 AppSwitcher가 사용. (Slice 2에서 Sidebar.js의 중복 정의를 이걸로 교체 예정)
// URL pathname → 현재 앱 키. 앱이 아니면(예: '/', '/my-tasks') null.
export function getAppContext(pathname) {
  if (pathname.startsWith('/canvas')) return 'canvas';
  if (pathname.startsWith('/branch')) return 'branch';
  if (pathname.startsWith('/tracks')) return 'track';
  return null;
}

// 각 앱의 진입(목록) 경로
export const APP_HOME = { branch: '/branch', canvas: '/canvas', track: '/tracks' };

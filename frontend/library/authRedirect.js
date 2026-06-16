export const LOGIN_PATH = '/auth/login';
export const CHANGE_PASSWORD_PATH = '/auth/change-password';
export const RESET_PATH = '/auth/reset';
export const SETUP_PATH = '/setup';

// 두 역할을 겸한다: (1) 무인증 접근 허용 경로(_app.js의 인증 게이트·noLayoutPaths의 단일 소스),
// (2) returnTo로 부적합한 경로(normalizeReturnTo의 차단 prefix — 로그인 후 다시 이리 보내면 루프).
// 지금은 두 집합이 같지만 정의상 같다는 보장은 없다. 무인증이면서 returnTo로는 유효한 공개 페이지
// (예: /welcome)가 생기면 PUBLIC_PATHS(접근)와 차단 prefix 목록을 둘로 분리할 것.
export const PUBLIC_PATHS = [LOGIN_PATH, CHANGE_PASSWORD_PATH, RESET_PATH, SETUP_PATH];

const FALLBACK_RETURN_TO = '/';

// 브라우저·Next의 URL 파서가 제거하거나(탭 0x09 / LF 0x0A / CR 0x0D 등 ASCII 제어문자, DEL 0x7F)
// '/'로 정규화하는(백슬래시 0x5C) 문자들. 원본 문자열만 보는 prefix 가드를 통과한 뒤
// '//evil.com'(외부 탈출)이나 공개 경로로 붕괴해 오픈 리다이렉트가 될 수 있어 원천 차단한다.
const UNSAFE_RETURN_TO_RE = /[\x00-\x1f\x7f\\]/;

export function normalizeReturnTo(value) {
  if (typeof value !== 'string') return FALLBACK_RETURN_TO;

  const target = value.trim();
  if (!target || !target.startsWith('/') || target.startsWith('//') || UNSAFE_RETURN_TO_RE.test(target)) {
    return FALLBACK_RETURN_TO;
  }

  const pathOnly = target.split(/[?#]/, 1)[0];
  if (PUBLIC_PATHS.some((prefix) => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`))) {
    return FALLBACK_RETURN_TO;
  }

  return target;
}

export function getReturnToFromQuery(query) {
  const returnTo = query?.returnTo;
  if (Array.isArray(returnTo)) return FALLBACK_RETURN_TO;
  return normalizeReturnTo(returnTo);
}

function buildAuthPath(basePath, returnTo) {
  const target = normalizeReturnTo(returnTo);
  if (target === FALLBACK_RETURN_TO) return basePath;

  const params = new URLSearchParams({ returnTo: target });
  return `${basePath}?${params.toString()}`;
}

export function buildLoginPath(returnTo) {
  return buildAuthPath(LOGIN_PATH, returnTo);
}

export function buildChangePasswordPath(returnTo) {
  return buildAuthPath(CHANGE_PASSWORD_PATH, returnTo);
}

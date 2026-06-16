const FALLBACK_RETURN_TO = '/';
const BLOCKED_PREFIXES = [
  '/auth/login',
  '/auth/change-password',
  '/auth/reset',
  '/setup',
];

// 브라우저·Next의 URL 파서가 제거하거나(탭 0x09 / LF 0x0A / CR 0x0D 등 ASCII 제어문자, DEL 0x7F)
// '/'로 정규화하는(백슬래시 0x5C) 문자들. 원본 문자열만 보는 prefix 가드를 통과한 뒤
// '//evil.com'(외부 탈출)이나 blocked prefix로 붕괴해 오픈 리다이렉트가 될 수 있어 원천 차단한다.
const UNSAFE_RETURN_TO_RE = /[\x00-\x1f\x7f\\]/;

export function normalizeReturnTo(value, fallback = FALLBACK_RETURN_TO) {
  if (typeof value !== 'string') return fallback;

  const target = value.trim();
  if (!target || !target.startsWith('/') || target.startsWith('//') || UNSAFE_RETURN_TO_RE.test(target)) {
    return fallback;
  }

  const pathOnly = target.split(/[?#]/, 1)[0];
  if (BLOCKED_PREFIXES.some((prefix) => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`))) {
    return fallback;
  }

  return target;
}

export function getReturnToFromQuery(query, fallback = FALLBACK_RETURN_TO) {
  const returnTo = query?.returnTo;
  if (Array.isArray(returnTo)) return fallback;
  return normalizeReturnTo(returnTo, fallback);
}

function buildAuthPath(basePath, returnTo) {
  const target = normalizeReturnTo(returnTo);
  if (target === FALLBACK_RETURN_TO) return basePath;

  const params = new URLSearchParams({ returnTo: target });
  return `${basePath}?${params.toString()}`;
}

export function buildLoginPath(returnTo) {
  return buildAuthPath('/auth/login', returnTo);
}

export function buildChangePasswordPath(returnTo) {
  return buildAuthPath('/auth/change-password', returnTo);
}

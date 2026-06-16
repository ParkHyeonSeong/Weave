const FALLBACK_RETURN_TO = '/';
const BLOCKED_PREFIXES = [
  '/auth/login',
  '/auth/change-password',
  '/auth/reset',
  '/setup',
];

export function normalizeReturnTo(value, fallback = FALLBACK_RETURN_TO) {
  if (typeof value !== 'string') return fallback;

  const target = value.trim();
  if (!target || !target.startsWith('/') || target.startsWith('//')) return fallback;

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

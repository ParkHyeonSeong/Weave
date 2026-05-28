// frontend/library/entityAppearance.js

export const COLOR_PRESETS = [
  '#5E6AD2', '#16A34A', '#DC2626', '#F59E0B',
  '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280',
];

export const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export const DEFAULT_COLORS = {
  branch: '#5E6AD2',
  track:  '#5E6AD2',
  canvas: '#16A34A',
};

// IconPicker가 보여주는 큐레이션 Lucide 목록.
// EntityIcon의 LUCIDE_MAP과 동기화 필요. legacy default(folder, book-open) 필수 포함.
export const CURATED_LUCIDE_ICONS = [
  // Legacy defaults
  'folder', 'book-open',
  // Work
  'briefcase', 'target', 'flag', 'rocket', 'trophy', 'list-todo', 'calendar', 'clock',
  // Tech
  'code', 'terminal', 'database', 'server', 'cpu', 'cloud', 'git-branch', 'bug',
  // Object
  'box', 'package', 'archive', 'file-text', 'image', 'paperclip', 'pin', 'tag',
  // Nature
  'leaf', 'flower', 'sun', 'moon', 'star', 'sparkles', 'flame', 'droplet',
  // Symbol
  'heart', 'shield', 'key', 'lock', 'eye', 'bookmark', 'compass', 'map',
  // Communication
  'message-square', 'mail', 'bell', 'phone', 'users', 'user', 'globe', 'link',
  // Creative
  'palette', 'brush', 'pen-tool', 'music', 'film', 'camera', 'gamepad-2', 'lightbulb',
  // Geometric
  'circle', 'square', 'triangle', 'hexagon', 'diamond', 'layers', 'grid-3x3', 'puzzle',
];

/**
 * Parse a stored icon string.
 *  - null/empty           → { type: 'none' }
 *  - 'lucide:rocket'      → { type: 'lucide', name: 'rocket' }
 *  - 'emoji:🚀'           → { type: 'emoji', char: '🚀' }
 *  - 'image:/api/...'     → { type: 'image', url: '/api/...' }
 *  - 'folder' (legacy)    → { type: 'lucide', name: 'folder' }
 */
export function parseIcon(value) {
  if (!value) return { type: 'none' };
  if (value.startsWith('lucide:')) return { type: 'lucide', name: value.slice(7) };
  if (value.startsWith('emoji:'))  return { type: 'emoji', char: value.slice(6) };
  if (value.startsWith('image:'))  return { type: 'image', url: value.slice(6) };
  return { type: 'lucide', name: value };
}

/**
 * Format a typed selection back to the storage string.
 */
export function formatIcon(type, payload) {
  if (!type || type === 'none' || !payload) return null;
  return `${type}:${payload}`;
}

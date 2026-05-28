import {
  Folder, BookOpen,
  Briefcase, Target, Flag, Rocket, Trophy, ListTodo, Calendar, Clock,
  Code, Terminal, Database, Server, Cpu, Cloud, GitBranch, Bug,
  Box, Package, Archive, FileText, Image, Paperclip, Pin, Tag,
  Leaf, Flower, Sun, Moon, Star, Sparkles, Flame, Droplet,
  Heart, Shield, Key, Lock, Eye, Bookmark, Compass, Map,
  MessageSquare, Mail, Bell, Phone, Users, User, Globe, Link,
  Palette, Brush, PenTool, Music, Film, Camera, Gamepad2, Lightbulb,
  Circle, Square, Triangle, Hexagon, Diamond, Layers, Grid3x3, Puzzle,
} from 'lucide-react';
import { parseIcon, DEFAULT_COLORS } from '@/library/entityAppearance';

export const LUCIDE_MAP = {
  'folder': Folder, 'book-open': BookOpen,
  'briefcase': Briefcase, 'target': Target, 'flag': Flag, 'rocket': Rocket,
  'trophy': Trophy, 'list-todo': ListTodo, 'calendar': Calendar, 'clock': Clock,
  'code': Code, 'terminal': Terminal, 'database': Database, 'server': Server,
  'cpu': Cpu, 'cloud': Cloud, 'git-branch': GitBranch, 'bug': Bug,
  'box': Box, 'package': Package, 'archive': Archive, 'file-text': FileText,
  'image': Image, 'paperclip': Paperclip, 'pin': Pin, 'tag': Tag,
  'leaf': Leaf, 'flower': Flower, 'sun': Sun, 'moon': Moon,
  'star': Star, 'sparkles': Sparkles, 'flame': Flame, 'droplet': Droplet,
  'heart': Heart, 'shield': Shield, 'key': Key, 'lock': Lock,
  'eye': Eye, 'bookmark': Bookmark, 'compass': Compass, 'map': Map,
  'message-square': MessageSquare, 'mail': Mail, 'bell': Bell, 'phone': Phone,
  'users': Users, 'user': User, 'globe': Globe, 'link': Link,
  'palette': Palette, 'brush': Brush, 'pen-tool': PenTool, 'music': Music,
  'film': Film, 'camera': Camera, 'gamepad-2': Gamepad2, 'lightbulb': Lightbulb,
  'circle': Circle, 'square': Square, 'triangle': Triangle, 'hexagon': Hexagon,
  'diamond': Diamond, 'layers': Layers, 'grid-3x3': Grid3x3, 'puzzle': Puzzle,
};

export default function EntityIcon({
  icon = null,
  color,
  size = 14,
  entityType = 'branch',
  className = '',
  onClick,
  title,
}) {
  const parsed = parseIcon(icon);
  const finalColor = color || DEFAULT_COLORS[entityType] || DEFAULT_COLORS.branch;

  const boxStyle = {
    width: size,
    height: size,
    borderRadius: '50%',
  };

  const baseClass = `EntityIcon ${onClick ? 'EntityIcon--clickable' : ''} ${className}`.trim();

  if (parsed.type === 'none') {
    return (
      <span
        className={`${baseClass} EntityIcon--dot`}
        style={{ ...boxStyle, background: finalColor }}
        onClick={onClick}
        title={title}
      />
    );
  }

  if (parsed.type === 'lucide') {
    const LucideIcon = LUCIDE_MAP[parsed.name] || Folder;
    return (
      <span
        className={`${baseClass} EntityIcon--lucide`}
        style={boxStyle}
        onClick={onClick}
        title={title}
      >
        <LucideIcon size={Math.round(size * 0.85)} color={finalColor} strokeWidth={2.2} />
      </span>
    );
  }

  if (parsed.type === 'emoji') {
    return (
      <span
        className={`${baseClass} EntityIcon--emoji`}
        style={{ ...boxStyle, fontSize: Math.round(size * 0.9), lineHeight: 1 }}
        onClick={onClick}
        title={title}
      >
        {parsed.char}
      </span>
    );
  }

  // image
  return (
    <span
      className={`${baseClass} EntityIcon--image`}
      style={boxStyle}
      onClick={onClick}
      title={title}
    >
      <img
        src={parsed.url}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </span>
  );
}

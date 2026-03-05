import {
  CheckSquare, Bug, BookOpen, Star, Zap, Shield,
  AlertTriangle, Wrench, Rocket, Flag, Target,
  Lightbulb, FileText, MessageSquare, Heart,
} from 'lucide-react';

const iconMap = {
  CheckSquare, Bug, BookOpen, Star, Zap, Shield,
  AlertTriangle, Wrench, Rocket, Flag, Target,
  Lightbulb, FileText, MessageSquare, Heart,
};

export const ICON_OPTIONS = Object.keys(iconMap).map((name) => ({ name }));

export default function TaskTypeIcon({ name, size = 16, color }) {
  const Icon = iconMap[name] || CheckSquare;
  return <Icon size={size} style={color ? { color } : undefined} />;
}

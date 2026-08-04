// Theme System for Amazon Tracker React Native App

export const COLORS = {
  bgPrimary: '#0f0c29',
  bgSecondary: '#1a1642',
  bgCard: 'rgba(30, 27, 75, 0.75)',
  bgCardHover: 'rgba(45, 38, 105, 0.85)',
  border: 'rgba(139, 92, 246, 0.25)',
  borderGlow: 'rgba(139, 92, 246, 0.5)',
  
  purple: '#8b5cf6',
  purpleLight: '#c4b5fd',
  purpleGlow: 'rgba(139, 92, 246, 0.4)',
  
  blue: '#3b82f6',
  green: '#10b981',
  orange: '#f59e0b',
  red: '#ef4444',
  
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
};

export const STATUS_LABELS = {
  pending: { label: '⏳ قيد الانتظار', color: COLORS.orange, bg: 'rgba(245, 158, 11, 0.15)' },
  shipped: { label: '🚚 تم الشحن', color: COLORS.blue, bg: 'rgba(59, 130, 246, 0.15)' },
  out_for_delivery: { label: '📦 خرج للتوصيل', color: COLORS.green, bg: 'rgba(16, 185, 129, 0.15)' },
  delivered: { label: '✅ تم التوصيل', color: COLORS.green, bg: 'rgba(16, 185, 129, 0.2)' },
  returned: { label: '↩️ مُعاد', color: COLORS.purple, bg: 'rgba(139, 92, 246, 0.15)' },
  cancelled: { label: '❌ مُلغى', color: COLORS.red, bg: 'rgba(239, 68, 68, 0.15)' },
};

export function formatPrice(val) {
  if (val === null || val === undefined || val === '') return '—';
  return `${parseFloat(val).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

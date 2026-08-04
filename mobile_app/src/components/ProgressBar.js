import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme';

export function ProgressBar({ mode, percent, processed, total, subject }) {
  const title = mode === 'ai' ? '🤖 جاري التحليل الذكي عبر Gemini...' : '🔄 جاري المزامنة السريعة...';
  const subText = total > 0
    ? `تم فحص ${processed} من أصل ${total} رسالة • ${subject || ''}`
    : 'جاري التراسل والتواصل مع أمازون...';

  return (
    <View style={styles.banner}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.percent}>{percent}%</Text>
      </View>
      
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, percent))}%` }]} />
      </View>
      
      <Text style={styles.subText} numberOfLines={1}>{subText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderColor: 'rgba(139, 92, 246, 0.35)',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  percent: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.purpleLight,
    fontFamily: 'monospace',
  },
  track: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: COLORS.purple,
    borderRadius: 6,
  },
  subText: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 6,
    textAlign: 'right',
  },
});

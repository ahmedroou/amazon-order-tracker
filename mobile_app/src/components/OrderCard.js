import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react'
import { COLORS, STATUS_LABELS, formatPrice, formatDate } from '../theme';
import * as Haptics from 'expo-haptics';

export function OrderCard({ order, onPress, onDelete }) {
  const statusInfo = STATUS_LABELS[order.status] || { label: order.status, color: COLORS.textSecondary, bg: 'rgba(255,255,255,0.08)' };

  const handleDelete = (e) => {
    e.stopPropagation();
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    if (onDelete) onDelete(order.id);
  };

  const handlePress = () => {
    try { Haptics.selectionAsync(); } catch {}
    if (onPress) onPress(order);
  };

  return (
    <TouchableOpacity style={[styles.card, { borderColor: statusInfo.color + '40' }]} onPress={handlePress} activeOpacity={0.8}>
      <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={styles.deleteText}>🗑️</Text>
      </TouchableOpacity>

      <View style={styles.imageContainer}>
        {order.product_image ? (
          <Image source={{ uri: order.product_image }} style={styles.image} resizeMode="cover" />
        ) : (
          <Text style={styles.placeholderIcon}>📦</Text>
        )}
      </View>

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>{order.product_name || 'منتج بدون اسم'}</Text>
        
        <View style={styles.metaRow}>
          <View style={[styles.badge, { backgroundColor: statusInfo.bg, borderColor: statusInfo.color + '60' }]}>
            <Text style={[styles.badgeText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          </View>
          <Text style={styles.email} numberOfLines={1}>{order.to_email || ''}</Text>
        </View>

        {order.notes ? (
          <Text style={styles.notes} numberOfLines={1}>🤖 {order.notes}</Text>
        ) : null}

        {order.order_date ? (
          <Text style={styles.date}>{formatDate(order.order_date)}</Text>
        ) : null}
      </View>

      <View style={styles.right}>
        <Text style={styles.price}>{formatPrice(order.purchase_price)}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    backgroundColor: COLORS.bgCard,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    paddingLeft: 34,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 10,
  },
  deleteBtn: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  deleteText: {
    fontSize: 10,
  },
  imageContainer: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholderIcon: {
    fontSize: 22,
  },
  info: {
    flex: 1,
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'right',
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    marginLeft: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  email: {
    fontSize: 10,
    color: COLORS.textMuted,
    maxWidth: 120,
  },
  notes: {
    fontSize: 10,
    color: COLORS.purpleLight,
    fontStyle: 'italic',
    marginTop: 2,
  },
  date: {
    fontSize: 9,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginRight: 8,
  },
  price: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
});

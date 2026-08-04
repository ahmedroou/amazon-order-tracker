import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, Image, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, formatPrice } from '../theme';
import { ApiService } from '../services/api';

export function AnalyticsScreen() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState('all');
  const [search, setSearch] = useState('');

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const res = await ApiService.getAnalytics(period, search);
      setData(res);
    } catch (e) {
      console.log('Fetch analytics error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [period, search]);

  const periods = [
    { key: 'all', label: 'الكل' },
    { key: 'today', label: 'اليوم' },
    { key: '7days', label: '7 أيام' },
    { key: '30days', label: '30 يوماً' },
    { key: 'month', label: 'هذا الشهر' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <Text style={styles.appTitle}>📊 تحليلات وتعداد المنتجات</Text>
      </View>

      {/* Period Filter Pills */}
      <View style={styles.filterBar}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={periods}
          keyExtractor={item => item.key}
          renderItem={({ item }) => {
            const active = period === item.key;
            return (
              <TouchableOpacity
                style={[styles.filterPill, active && styles.filterPillActive]}
                onPress={() => setPeriod(item.key)}
              >
                <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={{ paddingHorizontal: 16 }}
        />
      </View>

      {/* Stats Summary */}
      <View style={styles.statsGrid}>
        <View style={[styles.statCard, { borderLeftColor: COLORS.blue }]}>
          <Text style={styles.statLabel}>إجمالي القطع</Text>
          <Text style={styles.statValue}>{data?.total_items ?? '—'}</Text>
        </View>

        <View style={[styles.statCard, { borderLeftColor: COLORS.purple }]}>
          <Text style={styles.statLabel}>إجمالي التكلفة</Text>
          <Text style={styles.statValue}>{formatPrice(data?.total_spent)}</Text>
        </View>

        <View style={[styles.statCard, { borderLeftColor: COLORS.green }]}>
          <Text style={styles.statLabel}>منتجات فريدة</Text>
          <Text style={styles.statValue}>{data?.unique_products ?? '—'}</Text>
        </View>

        <View style={[styles.statCard, { borderLeftColor: COLORS.orange }]}>
          <Text style={styles.statLabel}>قطع ملغية</Text>
          <Text style={styles.statValue}>{data?.status_breakdown?.cancelled ?? 0}</Text>
        </View>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 ابحث عن منتج أو فئة (مثال: حفاضات، بسكويت)..."
          placeholderTextColor={COLORS.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Product Counter List */}
      <FlatList
        data={data?.top_products || []}
        keyExtractor={(item, idx) => idx.toString()}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchAnalytics} tintColor={COLORS.purple} />}
        renderItem={({ item }) => (
          <View style={styles.itemCard}>
            <View style={styles.imageContainer}>
              {item.product_image ? (
                <Image source={{ uri: item.product_image }} style={styles.image} resizeMode="cover" />
              ) : (
                <Text style={styles.placeholderIcon}>📦</Text>
              )}
            </View>

            <View style={styles.itemInfo}>
              <Text style={styles.itemTitle} numberOfLines={2}>{item.product_name}</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countText}>تم الشراء {item.count} مرات</Text>
              </View>
            </View>

            <View style={styles.itemRight}>
              <Text style={styles.itemCost}>{formatPrice(item.total_cost)}</Text>
              <Text style={styles.itemAvg}>المتوسط: {formatPrice(item.total_cost / item.count)}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={styles.emptyTitle}>لا توجد بيانات للفترة المحددة</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
  },
  topBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  appTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textPrimary,
    textAlign: 'right',
  },
  filterBar: {
    paddingVertical: 10,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginLeft: 8,
  },
  filterPillActive: {
    backgroundColor: COLORS.purple,
    borderColor: COLORS.purpleLight,
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  filterPillTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  statCard: {
    width: '48%',
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderLeftWidth: 4,
    marginBottom: 8,
  },
  statLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
    textAlign: 'right',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'right',
  },
  searchContainer: {
    paddingHorizontal: 16,
    marginVertical: 4,
  },
  searchInput: {
    backgroundColor: COLORS.bgCard,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    color: COLORS.textPrimary,
    fontSize: 12,
    textAlign: 'right',
  },
  listContent: {
    padding: 16,
  },
  itemCard: {
    backgroundColor: COLORS.bgCard,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 10,
  },
  imageContainer: {
    width: 44,
    height: 44,
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
    fontSize: 20,
  },
  itemInfo: {
    flex: 1,
    alignItems: 'flex-end',
  },
  itemTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'right',
    marginBottom: 4,
  },
  countBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderColor: COLORS.purple,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.purpleLight,
  },
  itemRight: {
    alignItems: 'flex-start',
    marginRight: 8,
  },
  itemCost: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  itemAvg: {
    fontSize: 9,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
});

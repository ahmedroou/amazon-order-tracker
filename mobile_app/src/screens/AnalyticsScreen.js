import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { fetchStats } from '../services/api';

export default function AnalyticsScreen() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAnalytics = useCallback(async () => {
    try {
      const data = await fetchStats();
      setStats(data);
    } catch (e) {
      console.log('Error loading analytics:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  if (loading && !refreshing) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const total = (stats?.total_orders || 1);
  const statuses = [
    { key: 'delivered', label: 'موصّل', color: colors.statusDelivered, icon: 'checkmark-circle' },
    { key: 'shipped', label: 'جاري الشحن', color: colors.statusShipped, icon: 'airplane' },
    { key: 'pending', label: 'انتظار', color: colors.statusPending, icon: 'time' },
    { key: 'cancelled', label: 'ملغي', color: colors.statusCancelled, icon: 'close-circle' },
    { key: 'returned', label: 'مُعاد', color: colors.statusReturned, icon: 'refresh' },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAnalytics(); }} colors={[colors.primary]} />
      }
    >
      <Text style={styles.headerTitle}>التحليلات والأداء</Text>

      {/* Financial Summary Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="bar-chart-outline" size={20} color={colors.primary} style={{ marginLeft: 6 }} />
          <Text style={styles.cardTitle}>الملخص المالي الشامل</Text>
        </View>

        <View style={styles.financialRow}>
          <View style={styles.finCol}>
            <Text style={styles.finLabel}>إجمالي التكلفة</Text>
            <Text style={[styles.finValue, { color: colors.statusCancelled }]}>
              {stats?.total_cost ? `${stats.total_cost.toFixed(0)}` : '0'}
            </Text>
            <Text style={styles.finCurrency}>ر.س</Text>
          </View>
          <View style={styles.verticalDivider} />

          <View style={styles.finCol}>
            <Text style={styles.finLabel}>إجمالي المبيعات</Text>
            <Text style={[styles.finValue, { color: colors.statusShipped }]}>
              {stats?.total_revenue ? `${stats.total_revenue.toFixed(0)}` : '0'}
            </Text>
            <Text style={styles.finCurrency}>ر.س</Text>
          </View>
          <View style={styles.verticalDivider} />

          <View style={styles.finCol}>
            <Text style={styles.finLabel}>صافي الربح</Text>
            <Text style={[styles.finValue, { color: (stats?.total_profit || 0) >= 0 ? colors.profitPositive : colors.profitNegative }]}>
              {stats?.total_profit ? `${stats.total_profit.toFixed(0)}` : '0'}
            </Text>
            <Text style={styles.finCurrency}>ر.س</Text>
          </View>
        </View>
      </View>

      {/* Status Breakdown Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="pie-chart-outline" size={20} color={colors.primary} style={{ marginLeft: 6 }} />
          <Text style={styles.cardTitle}>توزيع حالات الطلبات</Text>
        </View>

        {statuses.map((item) => {
          const count = stats?.by_status?.[item.key] || 0;
          const pct = Math.round((count / total) * 100);
          return (
            <View key={item.key} style={styles.progressRow}>
              <View style={styles.progressHeader}>
                <View style={styles.progressLabelGroup}>
                  <Ionicons name={item.icon} size={15} color={item.color} style={{ marginLeft: 4 }} />
                  <Text style={styles.progressLabel}>{item.label}</Text>
                </View>
                <Text style={[styles.progressPct, { color: item.color }]}>{count} ({pct}%)</Text>
              </View>
              <View style={styles.barBg}>
                <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: item.color }]} />
              </View>
            </View>
          );
        })}
      </View>

      {/* Accounts Breakdown Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="mail-outline" size={20} color={colors.primary} style={{ marginLeft: 6 }} />
          <Text style={styles.cardTitle}>إحصائيات الحسابات المرتبطة</Text>
        </View>

        {(stats?.by_email || []).map((acc, idx) => (
          <View key={idx} style={styles.accRow}>
            <View style={styles.accInfo}>
              <Ionicons name="at-outline" size={16} color={colors.primary} style={{ marginLeft: 6 }} />
              <Text style={styles.accEmail}>{acc.email}</Text>
            </View>
            <Text style={styles.accVal}>{acc.count} طلب  •  {acc.spent ? `${acc.spent.toFixed(0)} ر.س` : '0 ر.س'}</Text>
          </View>
        ))}
      </View>

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'right',
    marginBottom: 16,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  financialRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  finCol: {
    flex: 1,
    alignItems: 'center',
  },
  finLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  finValue: {
    fontSize: 17,
    fontWeight: 'bold',
  },
  finCurrency: {
    fontSize: 10,
    color: colors.textMuted,
  },
  verticalDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.divider,
  },
  progressRow: {
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  progressLabelGroup: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  progressLabel: {
    fontSize: 12,
    color: colors.textPrimary,
  },
  progressPct: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  barBg: {
    height: 8,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  accRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  accInfo: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  accEmail: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  accVal: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: 'bold',
  },
});

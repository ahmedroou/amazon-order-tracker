import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Clipboard,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { fetchStats, fetchOrders, fetchSyncStatus, triggerSync } from '../services/api';

export default function DashboardScreen() {
  const [stats, setStats] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [syncStatus, setSyncStatus] = useState({ is_syncing: false, progress: 0, message: '' });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingAction, setSyncingAction] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [sData, oData, sysData] = await Promise.all([
        fetchStats(),
        fetchOrders(null, 5, 0),
        fetchSyncStatus(),
      ]);
      setStats(sData);
      setRecentOrders(oData.orders || []);
      setSyncStatus(sysData);
    } catch (e) {
      console.log('Error loading dashboard data:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Poll sync status if syncing
  useEffect(() => {
    let interval = null;
    if (syncStatus.is_syncing || syncingAction) {
      interval = setInterval(async () => {
        const status = await fetchSyncStatus();
        setSyncStatus(status);
        if (!status.is_syncing) {
          setSyncingAction(false);
          loadData();
          clearInterval(interval);
        }
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [syncStatus.is_syncing, syncingAction, loadData]);

  const handleStartSync = async () => {
    setSyncingAction(true);
    try {
      const res = await triggerSync(false);
      Alert.alert('بدأت المزامنة', res.message || 'بدأت المزامنة الفورية في الخلفية');
    } catch (err) {
      Alert.alert('خطأ', 'فشلت المزامنة: ' + err.message);
      setSyncingAction(false);
    }
  };

  const copyText = (txt, label) => {
    Clipboard.setString(txt);
    Alert.alert('تم النسخ', `تم نسخ ${label} بنجاح`);
  };

  const renderStatusBadge = (status) => {
    const statusMap = {
      delivered: { label: 'موصّل', bg: colors.statusDeliveredBg, color: colors.statusDelivered, icon: 'checkmark-circle' },
      shipped: { label: 'شحن', bg: colors.statusShippedBg, color: colors.statusShipped, icon: 'airplane' },
      pending: { label: 'انتظار', bg: colors.statusPendingBg, color: colors.statusPending, icon: 'time' },
      cancelled: { label: 'ملغي', bg: colors.statusCancelledBg, color: colors.statusCancelled, icon: 'close-circle' },
      returned: { label: 'مُعاد', bg: colors.statusReturnedBg, color: colors.statusReturned, icon: 'refresh' },
    };
    const s = statusMap[status] || { label: status || 'غير محدد', bg: colors.surfaceSecondary, color: colors.textSecondary, icon: 'help-circle' };
    return (
      <View style={[styles.badge, { backgroundColor: s.bg }]}>
        <Ionicons name={s.icon} size={13} color={s.color} style={{ marginLeft: 4 }} />
        <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>جاري تحميل البيانات…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} colors={[colors.primary]} />
      }
    >
      {/* Greeting Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greetingSub}>مرحباً بك 👋</Text>
          <Text style={styles.greetingTitle}>لوحة المتابعة</Text>
        </View>
        <TouchableOpacity style={styles.syncIconButton} onPress={handleStartSync} disabled={syncingAction || syncStatus.is_syncing}>
          <Ionicons name="sync-outline" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Sync Status Live Card */}
      {(syncStatus.is_syncing || syncingAction) && (
        <View style={styles.syncCard}>
          <View style={styles.syncCardHeader}>
            <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 8 }} />
            <Text style={styles.syncTitle}>
              {syncStatus.message || 'جاري مزامنة الرسائل والطلبات…'}
            </Text>
          </View>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${Math.max(syncStatus.progress || 0, 5)}%` }]} />
          </View>
        </View>
      )}

      {/* Main KPI Stats 2x2 Grid */}
      <View style={styles.statsGrid}>
        {/* Total Orders Card */}
        <View style={styles.statCard}>
          <View style={[styles.iconCircle, { backgroundColor: '#FFF4E5' }]}>
            <Ionicons name="cube-outline" size={22} color={colors.primary} />
          </View>
          <Text style={styles.statValue}>{stats?.total_orders || 0}</Text>
          <Text style={styles.statLabel}>إجمالي الطلبات</Text>
        </View>

        {/* Total Profit Card */}
        <View style={styles.statCard}>
          <View style={[styles.iconCircle, { backgroundColor: '#E6F4F1' }]}>
            <Ionicons name="wallet-outline" size={22} color={colors.profitPositive} />
          </View>
          <Text style={[styles.statValue, { color: (stats?.total_profit || 0) >= 0 ? colors.profitPositive : colors.profitNegative }]}>
            {stats?.total_profit ? `${stats.total_profit.toFixed(0)} ر.س` : '0 ر.س'}
          </Text>
          <Text style={styles.statLabel}>صافي الربح</Text>
        </View>

        {/* Revenue Card */}
        <View style={styles.statCard}>
          <View style={[styles.iconCircle, { backgroundColor: '#EBF4FC' }]}>
            <Ionicons name="trending-up-outline" size={22} color={colors.statusShipped} />
          </View>
          <Text style={styles.statValue}>{stats?.total_revenue ? `${stats.total_revenue.toFixed(0)}` : '0'} <Text style={styles.currency}>ر.س</Text></Text>
          <Text style={styles.statLabel}>إجمالي المبيعات</Text>
        </View>

        {/* Cost Card */}
        <View style={styles.statCard}>
          <View style={[styles.iconCircle, { backgroundColor: '#FDF0EC' }]}>
            <Ionicons name="cart-outline" size={22} color={colors.statusPending} />
          </View>
          <Text style={styles.statValue}>{stats?.total_cost ? `${stats.total_cost.toFixed(0)}` : '0'} <Text style={styles.currency}>ر.س</Text></Text>
          <Text style={styles.statLabel}>إجمالي الشراء</Text>
        </View>
      </View>

      {/* Status Summary Quick Row */}
      <View style={styles.statusRowContainer}>
        <View style={[styles.statusMiniItem, { backgroundColor: colors.statusDeliveredBg }]}>
          <Text style={[styles.statusMiniCount, { color: colors.statusDelivered }]}>{stats?.by_status?.delivered || 0}</Text>
          <Text style={styles.statusMiniLabel}>موصّل ✅</Text>
        </View>
        <View style={[styles.statusMiniItem, { backgroundColor: colors.statusShippedBg }]}>
          <Text style={[styles.statusMiniCount, { color: colors.statusShipped }]}>{stats?.by_status?.shipped || 0}</Text>
          <Text style={styles.statusMiniLabel}>شحن 🚚</Text>
        </View>
        <View style={[styles.statusMiniItem, { backgroundColor: colors.statusPendingBg }]}>
          <Text style={[styles.statusMiniCount, { color: colors.statusPending }]}>{stats?.by_status?.pending || 0}</Text>
          <Text style={styles.statusMiniLabel}>انتظار ⏳</Text>
        </View>
      </View>

      {/* Quick Sync Button */}
      <TouchableOpacity style={styles.syncBigButton} onPress={handleStartSync} disabled={syncingAction || syncStatus.is_syncing}>
        <Ionicons name="refresh-circle" size={24} color="#FFF" style={{ marginLeft: 8 }} />
        <Text style={styles.syncBigButtonText}>
          {syncingAction ? 'جاري بدء المزامنة…' : 'تحديث ومزامنة الطلبات الآن'}
        </Text>
      </TouchableOpacity>

      {/* Recent Orders Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>أحدث الطلبات</Text>
      </View>

      {recentOrders.map((item) => (
        <View key={item.id} style={styles.orderCard}>
          <View style={styles.orderCardTop}>
            {renderStatusBadge(item.status)}
            <Text style={styles.orderDate}>{item.order_date ? item.order_date.substring(0, 10) : '—'}</Text>
          </View>

          <Text style={styles.productName} numberOfLines={2}>{item.product_name || 'منتج بدون اسم'}</Text>

          <View style={styles.orderIdRow}>
            <Text style={styles.orderIdLabel}>رقم الطلب: </Text>
            <Text style={styles.orderIdValue}>{item.amazon_order_id || '—'}</Text>
            {item.amazon_order_id && (
              <TouchableOpacity onPress={() => copyText(item.amazon_order_id, 'رقم الطلب')}>
                <Ionicons name="copy-outline" size={16} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.cardDivider} />

          <View style={styles.priceRow}>
            <View style={styles.priceCol}>
              <Text style={styles.priceLabel}>الشراء</Text>
              <Text style={styles.priceVal}>{item.purchase_price ? `${item.purchase_price.toFixed(1)} ر.س` : '—'}</Text>
            </View>
            <View style={styles.priceCol}>
              <Text style={styles.priceLabel}>البيع</Text>
              <Text style={styles.priceVal}>{item.sale_price ? `${item.sale_price.toFixed(1)} ر.س` : '—'}</Text>
            </View>
            <View style={styles.priceCol}>
              <Text style={styles.priceLabel}>الربح</Text>
              <Text style={[styles.priceVal, { color: (item.profit || 0) >= 0 ? colors.profitPositive : colors.profitNegative }]}>
                {item.profit !== null ? `${item.profit >= 0 ? '+' : ''}${item.profit.toFixed(1)} ر.س` : '—'}
              </Text>
            </View>
          </View>
        </View>
      ))}

      <View style={{ height: 30 }} />
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
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textSecondary,
  },
  header: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
    marginTop: 4,
  },
  greetingSub: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'right',
  },
  greetingTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'right',
  },
  syncIconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  syncCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  syncCardHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 10,
  },
  syncTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primaryDark,
    textAlign: 'right',
    flex: 1,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  statsGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statCard: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    alignItems: 'flex-end',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 2,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  statValue: {
    fontSize: 19,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  currency: {
    fontSize: 12,
    fontWeight: 'normal',
    color: colors.textSecondary,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  statusRowContainer: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statusMiniItem: {
    flex: 1,
    marginHorizontal: 4,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  statusMiniCount: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusMiniLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  syncBigButton: {
    flexDirection: 'row-reverse',
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  syncBigButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  sectionHeader: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'right',
  },
  orderCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 2,
  },
  orderCardTop: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  badge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  orderDate: {
    fontSize: 11,
    color: colors.textMuted,
  },
  productName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'right',
    marginBottom: 8,
  },
  orderIdRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 6,
  },
  orderIdLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  orderIdValue: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    fontFamily: 'monospace',
    marginLeft: 8,
  },
  cardDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: 10,
  },
  priceRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
  },
  priceCol: {
    alignItems: 'center',
  },
  priceLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  priceVal: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
});

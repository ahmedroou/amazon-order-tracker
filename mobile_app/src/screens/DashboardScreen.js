import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, formatPrice } from '../theme';
import { ApiService } from '../services/api';
import { OrderCard } from '../components/OrderCard';
import { ProgressBar } from '../components/ProgressBar';
import * as Haptics from 'expo-haptics';

export function DashboardScreen({ navigation }) {
  const [stats, setStats] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [syncState, setSyncState] = useState({ is_syncing: false, percent: 0 });
  const pollTimerRef = useRef(null);

  const loadData = async () => {
    try {
      const [statsData, ordersData] = await Promise.all([
        ApiService.getStats(),
        ApiService.getOrders({ limit: 5 }),
      ]);
      setStats(statsData);
      setRecentOrders(ordersData.orders || []);
    } catch (e) {
      console.log('Error loading dashboard:', e);
    }
  };

  const startPollingSync = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(async () => {
      try {
        const st = await ApiService.getSyncStatus();
        setSyncState(st);
        if (!st.is_syncing) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          loadData();
        }
      } catch (e) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }, 1200);
  };

  useEffect(() => {
    loadData();
    // Check initial sync status
    ApiService.getSyncStatus().then(st => {
      setSyncState(st);
      if (st.is_syncing) startPollingSync();
    }).catch(() => {});

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleSync = async (isAi = false) => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    try {
      const fn = isAi ? ApiService.triggerAISync : ApiService.triggerSync;
      const res = await fn();
      if (res.success === false) {
        Alert.alert('تنبيه', res.message);
      }
      startPollingSync();
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء البدء للمزامنة');
    }
  };

  const handleDeleteOrder = async (id) => {
    Alert.alert('تأكيد الحذف', 'هل تريد حذف هذا الطلب نهائياً؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف',
        style: 'destructive',
        onPress: async () => {
          try {
            await ApiService.deleteOrder(id);
            loadData();
          } catch {
            Alert.alert('خطأ', 'فشل الحذف');
          }
        }
      }
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <Text style={styles.appTitle}>📦 طلباتي — Amazon Tracker</Text>
        <View style={styles.syncButtonsGroup}>
          <TouchableOpacity style={styles.aiSyncBtn} onPress={() => handleSync(true)}>
            <Text style={styles.aiSyncText}>🤖 AI شاملة</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.syncBtn} onPress={() => handleSync(false)}>
            <Text style={styles.syncText}>🔄</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.purple} />}
      >
        {/* Progress Banner */}
        {syncState.is_syncing && (
          <ProgressBar
            mode={syncState.mode}
            percent={syncState.percent}
            processed={syncState.processed_emails}
            total={syncState.total_emails}
            subject={syncState.current_subject}
          />
        )}

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { borderLeftColor: COLORS.blue }]}>
            <Text style={styles.statLabel}>إجمالي الطلبات</Text>
            <Text style={styles.statValue}>{stats?.total_orders ?? '—'}</Text>
          </View>

          <View style={[styles.statCard, { borderLeftColor: COLORS.purple }]}>
            <Text style={styles.statLabel}>إجمالي الإنفاق</Text>
            <Text style={styles.statValue}>{formatPrice(stats?.total_cost)}</Text>
          </View>

          <View style={[styles.statCard, { borderLeftColor: COLORS.green }]}>
            <Text style={styles.statLabel}>إجمالي الأرباح</Text>
            <Text style={styles.statValue}>{formatPrice(stats?.total_profit)}</Text>
          </View>

          <View style={[styles.statCard, { borderLeftColor: COLORS.orange }]}>
            <Text style={styles.statLabel}>تم التوصيل</Text>
            <Text style={styles.statValue}>{stats?.by_status?.delivered ?? 0}</Text>
          </View>
        </View>

        {/* Section Header */}
        <View style={styles.sectionHeader}>
          <TouchableOpacity onPress={() => navigation.navigate('Orders')}>
            <Text style={styles.seeAllText}>عرض الكل ❯</Text>
          </TouchableOpacity>
          <Text style={styles.sectionTitle}>📦 أحدث الطلبات</Text>
        </View>

        {/* Recent Orders List */}
        {recentOrders.length > 0 ? (
          recentOrders.map(item => (
            <OrderCard
              key={item.id}
              order={item}
              onPress={() => navigation.navigate('Orders', { orderId: item.id })}
              onDelete={handleDeleteOrder}
            />
          ))
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📦</Text>
            <Text style={styles.emptyTitle}>لا توجد طلبات بعد</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
  },
  topBar: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  appTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  syncButtonsGroup: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  aiSyncBtn: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderColor: COLORS.purple,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  aiSyncText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.purpleLight,
  },
  syncBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  syncText: {
    fontSize: 14,
  },
  scrollContent: {
    padding: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statCard: {
    width: '48%',
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderLeftWidth: 4,
    marginBottom: 10,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textAlign: 'right',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'right',
  },
  sectionHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  seeAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.purple,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
});

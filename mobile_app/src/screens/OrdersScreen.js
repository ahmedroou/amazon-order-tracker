import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, Alert, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../theme';
import { ApiService } from '../services/api';
import { OrderCard } from '../components/OrderCard';

export function OrdersScreen() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const data = await ApiService.getOrders({
        status: statusFilter || undefined,
        limit: 150
      });
      setOrders(data.orders || []);
    } catch (e) {
      console.log('Fetch orders error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [statusFilter]);

  const handleDelete = (id) => {
    Alert.alert('تأكيد الحذف', 'هل تريد حذف هذا الطلب نهائياً؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف',
        style: 'destructive',
        onPress: async () => {
          try {
            await ApiService.deleteOrder(id);
            fetchOrders();
          } catch {
            Alert.alert('خطأ', 'فشل الحذف');
          }
        }
      }
    ]);
  };

  const filteredOrders = orders.filter(o => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (o.product_name || '').toLowerCase().includes(s) ||
      (o.amazon_order_id || '').toLowerCase().includes(s) ||
      (o.to_email || '').toLowerCase().includes(s)
    );
  });

  const filterButtons = [
    { key: '', label: 'الكل' },
    { key: 'pending', label: '⏳ انتظار' },
    { key: 'shipped', label: '🚚 شحن' },
    { key: 'delivered', label: '✅ وصل' },
    { key: 'cancelled', label: '❌ ملغى' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <Text style={styles.appTitle}>📦 قائمة الطلبات</Text>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 ابحث بالاسم، رقم الطلب، الإيميل..."
          placeholderTextColor={COLORS.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Filter Bar */}
      <View style={styles.filterBar}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={filterButtons}
          keyExtractor={item => item.key}
          renderItem={({ item }) => {
            const active = statusFilter === item.key;
            return (
              <TouchableOpacity
                style={[styles.filterPill, active && styles.filterPillActive]}
                onPress={() => setStatusFilter(item.key)}
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

      {/* Orders List */}
      <FlatList
        data={filteredOrders}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => (
          <OrderCard order={item} onDelete={handleDelete} />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchOrders} tintColor={COLORS.purple} />}
        ListEmptyComponent={(
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🔍</Text>
            <Text style={styles.emptyTitle}>لا توجد نتائج متطابقة</Text>
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
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  searchInput: {
    backgroundColor: COLORS.bgCard,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: COLORS.textPrimary,
    fontSize: 13,
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
  listContent: {
    padding: 16,
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

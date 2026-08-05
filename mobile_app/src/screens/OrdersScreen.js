import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Clipboard,
  Alert,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { fetchOrders } from '../services/api';

export default function OrdersScreen() {
  const [orders, setOrders] = useState([]);
  const [filteredOrders, setFilteredOrders] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadOrdersData = useCallback(async (statusFilter = selectedStatus) => {
    try {
      setLoading(true);
      const data = await fetchOrders(statusFilter, 200, 0);
      setOrders(data.orders || []);
      applyFilter(searchQuery, data.orders || []);
    } catch (e) {
      console.log('Error loading orders:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedStatus, searchQuery]);

  useEffect(() => {
    loadOrdersData(selectedStatus);
  }, [selectedStatus]);

  const applyFilter = (query, list = orders) => {
    if (!query.trim()) {
      setFilteredOrders(list);
      return;
    }
    const q = query.toLowerCase();
    const result = list.filter(
      (item) =>
        (item.product_name && item.product_name.toLowerCase().includes(q)) ||
        (item.amazon_order_id && item.amazon_order_id.toLowerCase().includes(q)) ||
        (item.tracking_number && item.tracking_number.toLowerCase().includes(q))
    );
    setFilteredOrders(result);
  };

  const handleSearchChange = (text) => {
    setSearchQuery(text);
    applyFilter(text, orders);
  };

  const copyText = (txt, label) => {
    Clipboard.setString(txt);
    Alert.alert('تم النسخ', `تم نسخ ${label} بنجاح`);
  };

  const statusChips = [
    { id: null, label: 'الكل' },
    { id: 'delivered', label: '✅ موصّل' },
    { id: 'shipped', label: '🚚 شحن' },
    { id: 'pending', label: '⏳ انتظار' },
    { id: 'cancelled', label: '❌ ملغي' },
    { id: 'returned', label: '↩️ مُعاد' },
  ];

  const renderOrderItem = ({ item }) => {
    const isDelivered = item.status === 'delivered';
    const isShipped = item.status === 'shipped';

    return (
      <View style={styles.orderCard}>
        <View style={styles.cardHeader}>
          <View style={[styles.badge, {
            backgroundColor: isDelivered ? colors.statusDeliveredBg : isShipped ? colors.statusShippedBg : colors.statusPendingBg
          }]}>
            <Text style={[styles.badgeText, {
              color: isDelivered ? colors.statusDelivered : isShipped ? colors.statusShipped : colors.statusPending
            }]}>
              {isDelivered ? '✅ موصّل' : isShipped ? '🚚 جاري الشحن' : item.status || 'معلق'}
            </Text>
          </View>
          <Text style={styles.orderDate}>{item.order_date ? item.order_date.substring(0, 10) : '—'}</Text>
        </View>

        <Text style={styles.productTitle} numberOfLines={2}>{item.product_name || 'منتج بدون اسم'}</Text>

        {/* Order ID Row */}
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>رقم الطلب: </Text>
          <Text style={styles.infoValue}>{item.amazon_order_id || '—'}</Text>
          {item.amazon_order_id && (
            <TouchableOpacity style={styles.copyBtn} onPress={() => copyText(item.amazon_order_id, 'رقم الطلب')}>
              <Ionicons name="copy-outline" size={15} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Tracking Row */}
        {item.tracking_number ? (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>التتبع: </Text>
            <Text style={[styles.infoValue, { color: colors.statusShipped }]}>{item.tracking_number}</Text>
            <TouchableOpacity style={styles.copyBtn} onPress={() => copyText(item.tracking_number, 'رقم التتبع')}>
              <Ionicons name="copy-outline" size={15} color={colors.statusShipped} />
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.divider} />

        {/* Financial Footer */}
        <View style={styles.priceContainer}>
          <View style={styles.priceBox}>
            <Text style={styles.priceTitle}>تكلفة الشراء</Text>
            <Text style={styles.priceNum}>{item.purchase_price ? `${item.purchase_price.toFixed(1)} ر.س` : '—'}</Text>
          </View>
          <View style={styles.priceBox}>
            <Text style={styles.priceTitle}>سعر البيع</Text>
            <Text style={styles.priceNum}>{item.sale_price ? `${item.sale_price.toFixed(1)} ر.س` : '—'}</Text>
          </View>
          <View style={styles.priceBox}>
            <Text style={styles.priceTitle}>الربح الصافي</Text>
            <Text style={[styles.priceNum, { color: (item.profit || 0) >= 0 ? colors.profitPositive : colors.profitNegative }]}>
              {item.profit !== null ? `${item.profit >= 0 ? '+' : ''}${item.profit.toFixed(1)} ر.س` : '—'}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Search Header */}
      <View style={styles.header}>
        <Text style={styles.title}>الطلبات والمنتجات</Text>

        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={20} color={colors.textSecondary} style={{ marginLeft: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="ابحث عن رقم طلب أو اسم منتج…"
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={handleSearchChange}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => handleSearchChange('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Chips Scroll */}
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={statusChips}
          keyExtractor={(c) => String(c.id)}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsContent}
          renderItem={({ item: chip }) => {
            const isSelected = selectedStatus === chip.id;
            return (
              <TouchableOpacity
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => setSelectedStatus(chip.id)}
              >
                <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                  {chip.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Orders List */}
      {loading && !refreshing ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredOrders}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderOrderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadOrdersData(); }} colors={[colors.primary]} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="tray-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>لا توجد طلبات تطابق هذا البحث</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: colors.surface,
    elevation: 2,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'right',
    marginBottom: 12,
  },
  searchBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  chipsScroll: {
    marginBottom: 4,
  },
  chipsContent: {
    flexDirection: 'row-reverse',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    marginLeft: 8,
  },
  chipSelected: {
    backgroundColor: colors.primary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chipTextSelected: {
    color: '#FFF',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
  },
  orderCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  orderDate: {
    fontSize: 11,
    color: colors.textMuted,
  },
  productTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'right',
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 4,
  },
  infoLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    fontFamily: 'monospace',
  },
  copyBtn: {
    marginRight: 6,
    padding: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: 10,
  },
  priceContainer: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
  },
  priceBox: {
    alignItems: 'center',
  },
  priceTitle: {
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  priceNum: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textMuted,
  },
});

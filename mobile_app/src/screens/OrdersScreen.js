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
    
    const getStatusText = () => {
      if (isDelivered) return '✅ موصّل';
      if (isShipped) return '🚚 شحن';
      if (item.status === 'pending') return '⏳ انتظار';
      if (item.status === 'cancelled') return '❌ ملغي';
      return item.status || 'معلق';
    };

    const getStatusBg = () => {
      if (isDelivered) return colors.statusDeliveredBg;
      if (isShipped) return colors.statusShippedBg;
      if (item.status === 'cancelled') return colors.statusCancelledBg;
      return colors.statusPendingBg;
    };

    const getStatusColor = () => {
      if (isDelivered) return colors.statusDelivered;
      if (isShipped) return colors.statusShipped;
      if (item.status === 'cancelled') return colors.statusCancelled;
      return colors.statusPending;
    };

    const orderIdFull = item.amazon_order_id ? item.amazon_order_id : 'لا يوجد رقم طلب';
    const dateStr = item.order_date ? item.order_date.substring(0, 10) : '';

    return (
      <TouchableOpacity style={styles.ocard} activeOpacity={0.7} onPress={() => {}}>
        <View style={styles.ocardHeader}>
          <Text style={styles.ocardIdFull} selectable>🆔 {orderIdFull}</Text>
          <View style={[styles.ocardBadge, { backgroundColor: getStatusBg() }]}>
            <Text style={[styles.ocardBadgeText, { color: getStatusColor() }]}>{getStatusText()}</Text>
          </View>
        </View>

        <View style={styles.ocardContent}>
          <View style={styles.ocardImgPlace}>
            <Text style={{fontSize:24}}>📦</Text>
          </View>
          <View style={styles.ocardBody}>
            <Text style={styles.ocardName} numberOfLines={2}>{item.product_name || 'منتج غير معروف'}</Text>
            
            <View style={styles.ocardRow1}>
              <Text style={styles.ocardEmail} numberOfLines={1}>✉️ {item.to_email || 'غير معروف'}</Text>
              {dateStr ? <Text style={styles.ocardDate}>{dateStr}</Text> : null}
            </View>
            
            <View style={styles.ocardRow2}>
              {item.purchase_price != null ? (
                <Text style={styles.ocardPrice}>{item.purchase_price.toFixed(2)} {item.currency || 'ر.س'}</Text>
              ) : null}
              {item.profit != null ? (
                <Text style={[styles.ocardProfit, { color: item.profit >= 0 ? colors.profitPositive : colors.profitNegative }]}>
                  {item.profit >= 0 ? '+' : ''}{item.profit.toFixed(1)}
                </Text>
              ) : null}
              <View style={{flex: 1}} />
              {item.tracking_number ? (
                <TouchableOpacity onPress={() => copyText(item.tracking_number, 'التتبع')} style={styles.trackBadge}>
                  <Text style={styles.ocardTrack} numberOfLines={1}>🚚 {item.tracking_number}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={{flexDirection: 'row-reverse', marginTop: 12}}>
               <TouchableOpacity 
                  style={{ backgroundColor: '#F0F0F0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, flexDirection: 'row-reverse', alignItems: 'center' }}
                  onPress={async () => {
                    try {
                      Alert.alert('جاري إنشاء رابط', 'يتم إنشاء رابط مشاركة...');
                      const res = await fetch(`https://84.8.102.52.sslip.io/api/orders/${item.id}/share`, { method: 'POST' });
                      const json = await res.json();
                      if (json.success) {
                        const url = `https://amazon-tracker.2026.ahmedroou.com${json.share_url}`;
                        Clipboard.setString(url);
                        Alert.alert('تم النسخ', `تم إنشاء رابط مشاركة ونسخه بنجاح!\n${url}`);
                      }
                    } catch (e) {
                      Alert.alert('خطأ', 'تعذر إنشاء رابط مشاركة');
                    }
                  }}
               >
                 <Ionicons name="share-social-outline" size={16} color={colors.primary} />
                 <Text style={{ fontSize: 12, color: colors.primary, marginRight: 4 }}>مشاركة التتبع</Text>
               </TouchableOpacity>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const handleCleanup = async () => {
    Alert.alert(
      'تنظيف المكررات',
      'سيتم مسح الطلبات القديمة المكررة والإبقاء على أحدث نسخة لكل طلب. هل أنت متأكد؟',
      [
        { text: 'إلغاء', style: 'cancel' },
        { 
          text: 'تنظيف', 
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              const res = await fetch('https://84.8.102.52.sslip.io/api/orders/cleanup', { method: 'POST' });
              const data = await res.json();
              if (data.success) {
                Alert.alert('تم التنظيف', `تم مسح ${data.cleaned_count} بطاقة مكررة بنجاح!`);
                loadOrdersData();
              }
            } catch (e) {
              Alert.alert('خطأ', 'تعذر تنظيف الطلبات');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* Search Header */}
      <View style={styles.header}>
        <View style={{flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12}}>
          <Text style={styles.title}>الطلبات والمنتجات</Text>
          <TouchableOpacity onPress={handleCleanup} style={styles.cleanupBtn}>
            <Ionicons name="trash-bin-outline" size={16} color={colors.primary} />
            <Text style={styles.cleanupText}>تنظيف</Text>
          </TouchableOpacity>
        </View>

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
  },
  cleanupBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: 'rgba(79, 195, 247, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  cleanupText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
    marginRight: 4,
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
    padding: 12,
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
  /* --- Compact Card (ocard) --- */
  ocard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 10,
    elevation: 2,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.8,
    shadowRadius: 2,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  ocardHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  ocardIdFull: {
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textPrimary,
    fontFamily: 'monospace',
  },
  ocardContent: {
    flexDirection: 'row-reverse',
    padding: 10,
    alignItems: 'center',
  },
  ocardImgPlace: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ocardBody: {
    flex: 1,
    justifyContent: 'center',
  },
  ocardName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'right',
    marginBottom: 6,
  },
  ocardRow1: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  ocardEmail: {
    fontSize: 11,
    color: colors.textMuted,
    flex: 1,
    textAlign: 'right',
  },
  ocardBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  ocardBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  ocardDate: {
    fontSize: 10,
    color: colors.textMuted,
    marginLeft: 8,
  },
  ocardRow2: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  ocardPrice: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginLeft: 8,
  },
  ocardProfit: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  trackBadge: {
    backgroundColor: 'rgba(79, 195, 247, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(79, 195, 247, 0.3)',
  },
  ocardTrack: {
    fontSize: 11,
    color: colors.primary,
    fontFamily: 'monospace',
    textAlign: 'left',
  },
});

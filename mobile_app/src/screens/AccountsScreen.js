import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

const API = 'https://amazon-tracker.2026.ahmedroou.com';

export default function AccountsScreen({ navigation }) {
  const [data, setData] = useState({ gmail_accounts: [], amazon_accounts: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const res = await fetch(`${API}/api/accounts/summary`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      Alert.alert("خطأ", "تعذر تحميل بيانات الحسابات");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const getAvatarColor = (email) => {
    const bgColors = ['#EA4335', '#4285F4', '#34A853', '#FBBC05', '#8E24AA', '#D81B60'];
    let hash = 0;
    for (let i = 0; i < (email || '').length; i++) hash += email.charCodeAt(i);
    return bgColors[Math.abs(hash) % bgColors.length];
  };

  const getInitial = (email) => (email && email.length ? email[0].toUpperCase() : '?');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>إدارة الحسابات المتقدمة</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 50 }} />
        ) : (
          <>
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="logo-amazon" size={24} color="#FF9900" />
                <Text style={styles.sectionTitle}>حسابات أمازون الفرعية</Text>
              </View>
              <Text style={styles.sectionDesc}>
                هذه الحسابات تم اكتشافها تلقائياً من خلال الإيميل المستلم للطلبات (مثل Aliases).
              </Text>

              {data.amazon_accounts.length === 0 ? (
                <Text style={{ textAlign: 'center', marginTop: 10 }}>لا توجد حسابات أمازون مسجلة بعد</Text>
              ) : (
                data.amazon_accounts.map((acc, index) => (
                  <View key={index} style={[styles.card, !acc.is_active && styles.cardInactive]}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.avatar, { backgroundColor: getAvatarColor(acc.to_email) }]}>
                        <Text style={styles.avatarText}>{getInitial(acc.to_email)}</Text>
                      </View>
                      <View style={{ flex: 1, marginRight: 10 }}>
                        <Text style={styles.emailText}>{acc.to_email}</Text>
                        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', marginTop: 4 }}>
                          <View style={[styles.statusDot, { backgroundColor: acc.is_active ? '#34A853' : '#9AA0A6' }]} />
                          <Text style={styles.statusText}>{acc.is_active ? 'نشط (مؤخراً)' : 'غير نشط'}</Text>
                        </View>
                      </View>
                    </View>
                    
                    <View style={styles.statsRow}>
                      <View style={styles.statBox}>
                        <Text style={styles.statLabel}>الطلبات</Text>
                        <Text style={styles.statValue}>{acc.total_orders}</Text>
                      </View>
                      <View style={styles.statBox}>
                        <Text style={styles.statLabel}>المصروفات</Text>
                        <Text style={styles.statValue}>{acc.total_spent} ر.س</Text>
                      </View>
                      <View style={styles.statBox}>
                        <Text style={styles.statLabel}>آخر طلب</Text>
                        <Text style={[styles.statValue, { fontSize: 11 }]}>
                          {acc.days_since_last_order >= 0 ? `منذ ${acc.days_since_last_order} يوم` : 'غير متوفر'}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="mail" size={24} color="#EA4335" />
                <Text style={styles.sectionTitle}>ملخص حسابات Gmail</Text>
              </View>

              {data.gmail_accounts.map((acc, index) => (
                <View key={index} style={styles.gmailCard}>
                  <Text style={styles.gmailEmail}>{acc.email}</Text>
                  <Text style={styles.gmailStatus}>
                    الحالة: {acc.health_status === 'healthy' ? '✅ متصل' : '❌ يحتاج صيانة'}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    padding: 16,
    paddingTop: 45, // Add some top padding for safe area since header is hidden
    backgroundColor: colors.surface,
    elevation: 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backBtn: {
    padding: 5,
    marginLeft: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginRight: 8,
  },
  sectionDesc: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 16,
    textAlign: 'right',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardInactive: {
    opacity: 0.75,
    backgroundColor: '#FAFAFA',
  },
  cardHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  emailText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'right',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 4,
  },
  statusText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  statsRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: 12,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  gmailCard: {
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gmailEmail: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'right',
  },
  gmailStatus: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: 4,
  }
});

import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import {
  fetchSyncStatus,
  triggerSync,
  getExportUrl,
  fetchAccounts,
  deleteAccount,
  syncAccountManual,
  getAddAccountUrl,
  addAccount,
} from '../services/api';

export default function SettingsScreen() {
  const [serverOnline, setServerOnline] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [aiSyncing, setAiSyncing] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionAccId, setActionAccId] = useState(null);

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setAccountsLoading(true);
    await Promise.all([checkServer(), loadAccountsList()]);
    setAccountsLoading(false);
    setRefreshing(false);
  };

  const checkServer = async () => {
    try {
      await fetchSyncStatus();
      setServerOnline(true);
    } catch (e) {
      setServerOnline(false);
    }
  };

  const loadAccountsList = async () => {
    try {
      const data = await fetchAccounts();
      setAccounts(data || []);
    } catch (e) {
      console.log('Error fetching accounts:', e);
    }
  };

  const handleAddAccount = async () => {
    const url = getAddAccountUrl();
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert('رابط الإضافة', url);
      }
    } catch (err) {
      Alert.alert('خطأ', 'تعذر فتح صفحة التفويض: ' + err.message);
    }
  };

  const handleDeleteAccount = (acc) => {
    Alert.alert(
      'إلغاء ربط الحساب',
      `هل أنت تأكد من إزالة حساب ${acc.email}؟`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'إزالة الحساب',
          style: 'destructive',
          onPress: async () => {
            setActionAccId(acc.id);
            try {
              await deleteAccount(acc.id);
              Alert.alert('تم الإزالة', `تم حذف حساب ${acc.email} بنجاح`);
              loadAccountsList();
            } catch (err) {
              Alert.alert('خطأ', 'فشلت إزالة الحساب: ' + err.message);
            } finally {
              setActionAccId(null);
            }
          },
        },
      ]
    );
  };

  const handleSyncSingleAccount = async (acc) => {
    setActionAccId(acc.id);
    try {
      const res = await syncAccountManual(acc.id);
      Alert.alert('تمت المزامنة', `تم العثور على ${res.new_orders || 0} طلبات جديدة لحساب ${acc.email}`);
      loadAccountsList();
    } catch (err) {
      Alert.alert('خطأ', 'فشلت المزامنة: ' + err.message);
    } finally {
      setActionAccId(null);
    }
  };

  const handleSync = async (isAi = false) => {
    if (isAi) setAiSyncing(true); else setSyncing(true);
    try {
      const res = await triggerSync(isAi);
      Alert.alert('نجاح', res.message || 'بدأت عملية المزامنة بنجاح في الخلفية');
    } catch (err) {
      Alert.alert('خطأ', 'فشلت المزامنة: ' + err.message);
    } finally {
      setSyncing(false);
      setAiSyncing(false);
    }
  };

  const handleExportCSV = async () => {
    const url = getExportUrl();
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      Linking.openURL(url);
    } else {
      Alert.alert('رابط التصدير', url);
    }
  };

  const getAvatarColor = (email) => {
    const bgColors = ['#EA4335', '#4285F4', '#34A853', '#FBBC05', '#8E24AA', '#D81B60'];
    let hash = 0;
    for (let i = 0; i < (email || '').length; i++) hash += email.charCodeAt(i);
    return bgColors[Math.abs(hash) % bgColors.length];
  };

  const getInitial = (email) => {
    return email && email.length ? email[0].toUpperCase() : 'G';
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            loadAllData();
          }}
          colors={[colors.primary]}
        />
      }
    >
      <Text style={styles.headerTitle}>الإعدادات والخدمات</Text>

      {/* App Info Banner */}
      <View style={styles.card}>
        <View style={styles.appHeaderRow}>
          <View style={styles.appIconBg}>
            <Ionicons name="cube" size={28} color="#FFF" />
          </View>
          <View style={styles.appTitleCol}>
            <Text style={styles.appName}>طلباتي — Amazon Tracker</Text>
            <Text style={styles.appVersion}>الإصدار 3.0.0 (Gmail Connected Pro)</Text>
          </View>
        </View>
      </View>

      {/* Gmail Accounts Section — Designed like Gmail Account Switcher */}
      <View style={styles.card}>
        <View style={styles.gmailSectionHeader}>
          <View style={styles.cardHeader}>
            <Ionicons name="mail-outline" size={22} color="#EA4335" style={{ marginLeft: 6 }} />
            <Text style={styles.cardTitle}>حسابات Gmail المربوطة</Text>
          </View>
          <TouchableOpacity style={styles.addAccountHeaderBtn} onPress={handleAddAccount}>
            <Ionicons name="add" size={18} color="#EA4335" />
            <Text style={styles.addAccountHeaderBtnText}>إضافة</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.gmailSectionDesc}>
          أضف وأدر حسابات Gmail المربوطة لتفقد فواتير ورسائل أمازون تلقائياً
        </Text>

        {accountsLoading ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 15 }} />
        ) : accounts.length === 0 ? (
          <View style={styles.emptyAccountsContainer}>
            <Ionicons name="mail-unread-outline" size={40} color="#EA4335" style={{ marginBottom: 8 }} />
            <Text style={styles.emptyTitle}>لا توجد حسابات Gmail مربوطة</Text>
            <Text style={styles.emptyDesc}>اضغط على الزر أدناه لربط حسابك عبر Google OAuth بأمان</Text>
          </View>
        ) : (
          <View style={styles.accountsList}>
            {accounts.map((acc) => (
              <View key={acc.id} style={styles.accountCard}>
                <View style={styles.accountMainRow}>
                  {/* Gmail Avatar Circle */}
                  <View style={[styles.avatarBubble, { backgroundColor: getAvatarColor(acc.email) }]}>
                    <Text style={styles.avatarText}>{getInitial(acc.email)}</Text>
                  </View>

                  {/* Info Column */}
                  <View style={styles.accountInfoCol}>
                    <Text style={styles.accountEmail} numberOfLines={1}>
                      {acc.email}
                    </Text>
                    <View style={styles.accountBadgesRow}>
                      <View
                        style={[
                          styles.statusBadge,
                          {
                            backgroundColor:
                              acc.status === 'active' ? '#E6F4EA' : '#FCE8E6',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            {
                              color:
                                acc.status === 'active' ? '#137333' : '#C5221F',
                            },
                          ]}
                        >
                          {acc.status === 'active' ? '🟢 نشط' : '⚠️ يلزم إعادة الربط'}
                        </Text>
                      </View>

                      <View style={styles.orderCountBadge}>
                        <Text style={styles.orderCountText}>{acc.order_count || 0} طلب</Text>
                      </View>
                    </View>
                  </View>

                  {/* Actions */}
                  <View style={styles.accountActionsRow}>
                    {actionAccId === acc.id ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <>
                        <TouchableOpacity
                          style={styles.accSyncBtn}
                          onPress={() => handleSyncSingleAccount(acc)}
                          title="فحص فوري"
                        >
                          <Ionicons name="sync-outline" size={18} color={colors.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.accDeleteBtn}
                          onPress={() => handleDeleteAccount(acc)}
                          title="حذف الحساب"
                        >
                          <Ionicons name="trash-outline" size={18} color="#EA4335" />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Big Gmail Add Button */}
        <TouchableOpacity style={styles.addAccountBigBtn} onPress={handleAddAccount}>
          <View style={styles.gmailIconCircle}>
            <Ionicons name="mail" size={20} color="#EA4335" />
          </View>
          <Text style={styles.addAccountBigBtnText}>+ ربط حساب Gmail جديد</Text>
        </TouchableOpacity>
      </View>

      {/* Server Health Status Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="server-outline" size={20} color={colors.primary} style={{ marginLeft: 6 }} />
          <Text style={styles.cardTitle}>حالة الخادم والربط</Text>
        </View>

        <View style={styles.serverRow}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  serverOnline === true
                    ? colors.statusDelivered
                    : serverOnline === false
                    ? colors.statusCancelled
                    : colors.statusPending,
              },
            ]}
          />
          <Text style={styles.serverDomain}>https://84.8.102.52.sslip.io</Text>
        </View>

        <Text style={styles.serverDesc}>
          {serverOnline === true
            ? '✅ الخادم يعمل بشكل ممتاز وتطابق المزامنة نشط'
            : serverOnline === false
            ? '❌ يتعذر الاتصال بالخادم الرئيسي'
            : '⏳ جاري الفحص…'}
        </Text>
      </View>

      {/* Action Triggers */}
      <View style={styles.card}>
        <Text style={styles.sectionHeading}>⚡ الإجراءات الفورية</Text>

        <TouchableOpacity style={styles.actionBtn} onPress={() => handleSync(false)} disabled={syncing}>
          <Ionicons name="refresh-outline" size={20} color="#FFF" style={{ marginLeft: 8 }} />
          <Text style={styles.actionBtnText}>{syncing ? 'جاري المزامنة…' : 'مزامنة سريعة كل 30 دقيقة'}</Text>
          {syncing && <ActivityIndicator size="small" color="#FFF" style={{ marginRight: 8 }} />}
        </TouchableOpacity>

        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#6D28D9' }]} onPress={() => handleSync(true)} disabled={aiSyncing}>
          <Ionicons name="sparkles-outline" size={20} color="#FFF" style={{ marginLeft: 8 }} />
          <Text style={styles.actionBtnText}>{aiSyncing ? 'جاري الفحص الذكي…' : 'تدقيق الذكاء الاصطناعي (AI Audit)'}</Text>
          {aiSyncing && <ActivityIndicator size="small" color="#FFF" style={{ marginRight: 8 }} />}
        </TouchableOpacity>

        <TouchableOpacity style={styles.outlinedBtn} onPress={handleExportCSV}>
          <Ionicons name="download-outline" size={20} color={colors.primary} style={{ marginLeft: 8 }} />
          <Text style={styles.outlinedBtnText}>تصدير تقرير Excel / CSV</Text>
        </TouchableOpacity>
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
  appHeaderRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  appIconBg: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  appTitleCol: {
    flex: 1,
  },
  appName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'right',
  },
  appVersion: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'right',
    marginTop: 2,
  },
  gmailSectionHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  gmailSectionDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'right',
    marginBottom: 14,
  },
  addAccountHeaderBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#FCE8E6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  addAccountHeaderBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#EA4335',
    marginRight: 2,
  },
  emptyAccountsContainer: {
    alignItems: 'center',
    paddingVertical: 18,
    backgroundColor: colors.background,
    borderRadius: 12,
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  emptyDesc: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  accountsList: {
    marginBottom: 14,
  },
  accountCard: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  accountMainRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  avatarBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  avatarText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  accountInfoCol: {
    flex: 1,
    alignItems: 'flex-end',
  },
  accountEmail: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'right',
  },
  accountBadgesRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  orderCountBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  orderCountText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: colors.primary,
  },
  accountActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
    gap: 6,
  },
  accSyncBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
  },
  accDeleteBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#FCE8E6',
  },
  addAccountBigBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EA4335',
    borderRadius: 12,
    paddingVertical: 12,
    shadowColor: '#EA4335',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  gmailIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  addAccountBigBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  cardHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  serverRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 6,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: 8,
  },
  serverDomain: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: colors.textPrimary,
  },
  serverDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'right',
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'right',
    marginBottom: 14,
  },
  actionBtn: {
    flexDirection: 'row-reverse',
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  actionBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  outlinedBtn: {
    flexDirection: 'row-reverse',
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  outlinedBtnText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  modalHeaderRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#111827',
  },
  modalDesc: {
    fontSize: 13,
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  modalInput: {
    width: '100%',
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    textAlign: 'center',
    marginBottom: 16,
  },
  modalConfirmBtn: {
    width: '100%',
    backgroundColor: '#EA4335',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  modalConfirmBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  modalSecondaryBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginBottom: 6,
  },
  modalSecondaryBtnText: {
    color: '#4B5563',
    fontSize: 13,
    fontWeight: '500',
  },
  modalCancelBtn: {
    paddingVertical: 8,
  },
  modalCancelBtnText: {
    color: '#9CA3AF',
    fontSize: 13,
  },
});


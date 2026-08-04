import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, Alert, Linking, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../theme';
import { ApiService, getBaseUrl, setBaseUrl } from '../services/api';

export function SettingsScreen() {
  const [serverUrl, setServerUrlInput] = useState(getBaseUrl());
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const data = await ApiService.getAccounts();
      setAccounts(data || []);
    } catch (e) {
      console.log('Fetch accounts error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleSaveServerUrl = () => {
    setBaseUrl(serverUrl);
    Alert.alert('✅ نجاح', 'تم تحديث رابط السيرفر المباشر بنجاح');
    fetchAccounts();
  };

  const handleConnectGmail = () => {
    const url = `${getBaseUrl()}/auth/gmail`;
    Linking.openURL(url).catch(() => {
      Alert.alert('خطأ', 'تعذر فتح صفحة التفويض');
    });
  };

  const handleDeleteAccount = (id) => {
    Alert.alert('حذف الحساب', 'هل تريد إلغاء ربط هذا الحساب وحذف طلباته؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'إلغاء الربط',
        style: 'destructive',
        onPress: async () => {
          try {
            await ApiService.deleteAccount(id);
            fetchAccounts();
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
        <Text style={styles.appTitle}>⚙️ إعدادات التطبيق والسيرفر</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchAccounts} tintColor={COLORS.purple} />}
      >
        {/* Server Connection Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>🌐 رابط خادم Backend السحابي</Text>
          <Text style={styles.sectionDesc}>عنوان السيرفر الحالي لربط البيانات لحظياً:</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrlInput}
            placeholder="https://84.8.102.52.sslip.io"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.saveBtn} onPress={handleSaveServerUrl}>
            <Text style={styles.saveBtnText}>حفظ وتحديث الرابط</Text>
          </TouchableOpacity>
        </View>

        {/* Gmail OAuth Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>🔗 ربط حساب Gmail</Text>
          <Text style={styles.sectionDesc}>اضغط هنا لفتح المتصفح وتفويض قراءة رسائل أمازون عبر Gmail:</Text>
          <TouchableOpacity style={styles.connectBtn} onPress={handleConnectGmail}>
            <Text style={styles.connectBtnText}>🔑 ربط حساب Gmail جديد</Text>
          </TouchableOpacity>
        </View>

        {/* Accounts List Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>📧 الحسابات المربوطة حالياً</Text>
          {accounts.length > 0 ? (
            accounts.map(acc => (
              <View key={acc.id} style={styles.accountRow}>
                <TouchableOpacity style={styles.deleteAccBtn} onPress={() => handleDeleteAccount(acc.id)}>
                  <Text style={styles.deleteAccText}>حذف</Text>
                </TouchableOpacity>
                <View style={styles.accInfo}>
                  <Text style={styles.accEmail}>{acc.email}</Text>
                  <Text style={styles.accMeta}>{acc.order_count} طلب مسجل</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>لا يوجد حسابات مربوطة حتى الآن</Text>
          )}
        </View>

        {/* Dual Scheduler Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>⏰ نظام المزامنة والتدقيق الآلي</Text>
          <Text style={styles.scheduleText}>• ⚡ <Text style={styles.boldText}>المزامنة السريعة:</text> تعمل تلقائياً كل 30 دقيقة.</Text>
          <Text style={styles.scheduleText}>• 🤖 <Text style={styles.boldText}>المراجع والمدقق الذكي:</Text> ينطلق تلقائياً كل 4 ساعات عبر Gemini 3.6 Flash.</Text>
        </View>

        {/* App Info */}
        <View style={styles.appInfoCard}>
          <Text style={styles.infoAppName}>Amazon Order Tracker Native v1.0</Text>
          <Text style={styles.infoAppSub}>تطبيق جوال تفاعلي بنظام React Native مرتبك بالسيرفر السحابي</Text>
        </View>
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
  scrollContent: {
    padding: 16,
  },
  sectionCard: {
    backgroundColor: COLORS.bgCard,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'right',
    marginBottom: 6,
  },
  sectionDesc: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textAlign: 'right',
    marginBottom: 10,
    lineHeight: 16,
  },
  input: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: COLORS.textPrimary,
    fontSize: 12,
    marginBottom: 10,
  },
  saveBtn: {
    backgroundColor: COLORS.purple,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  connectBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderColor: COLORS.green,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  connectBtnText: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: '700',
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  accInfo: {
    alignItems: 'flex-end',
  },
  accEmail: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  accMeta: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  deleteAccBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  deleteAccText: {
    color: COLORS.red,
    fontSize: 10,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: 8,
  },
  scheduleText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textAlign: 'right',
    marginBottom: 6,
    lineHeight: 18,
  },
  boldText: {
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  appInfoCard: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  infoAppName: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  infoAppSub: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 4,
  },
});

import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

import DashboardScreen from '../screens/DashboardScreen';
import OrdersScreen from '../screens/OrdersScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SmartAssistantScreen from '../screens/SmartAssistantScreen';

const Tab = createBottomTabNavigator();

export default function AppNavigator() {
  const insets = useSafeAreaInsets();

  // Dynamic bottom tab height including bottom safe area (gesture bar / nav buttons)
  const tabHeight = 64 + (insets.bottom > 0 ? insets.bottom : 8);

  return (
    <View style={[styles.wrapper, { paddingTop: insets.top }]}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: [
            styles.tabBar,
            {
              height: tabHeight,
              paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
              paddingTop: 8,
            },
          ],
          tabBarLabelStyle: styles.tabBarLabel,
          tabBarIcon: ({ focused, color, size }) => {
            let iconName = 'cube-outline';
            if (route.name === 'الرئيسية') {
              iconName = focused ? 'home' : 'home-outline';
            } else if (route.name === 'الطلبات') {
              iconName = focused ? 'clipboard' : 'clipboard-outline';
            } else if (route.name === 'التحليلات') {
              iconName = focused ? 'stats-chart' : 'stats-chart-outline';
            } else if (route.name === 'المساعد') {
              iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
            } else if (route.name === 'الإعدادات') {
              iconName = focused ? 'settings' : 'settings-outline';
            }
            return <Ionicons name={iconName} size={22} color={color} />;
          },
        })}
      >
        <Tab.Screen name="الرئيسية" component={DashboardScreen} />
        <Tab.Screen name="الطلبات" component={OrdersScreen} />
        <Tab.Screen name="التحليلات" component={AnalyticsScreen} />
        <Tab.Screen name="المساعد" component={SmartAssistantScreen} />
        <Tab.Screen name="الإعدادات" component={SettingsScreen} />
      </Tab.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: colors.background,
  },
  tabBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    elevation: 8,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 2,
  },
});

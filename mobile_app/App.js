import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, Text, StyleSheet } from 'react-native';

import { COLORS } from './src/theme';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { AnalyticsScreen } from './src/screens/AnalyticsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

const Tab = createBottomTabNavigator();

function TabIcon({ icon, label, focused }) {
  return (
    <View style={styles.tabIconContainer}>
      <Text style={[styles.tabIconText, { opacity: focused ? 1 : 0.6 }]}>{icon}</Text>
      <Text style={[styles.tabLabel, { color: focused ? COLORS.purpleLight : COLORS.textMuted }]}>
        {label}
      </Text>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor={COLORS.bgPrimary} />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarShowLabel: false,
            tabBarStyle: styles.tabBar,
          }}
        >
          <Tab.Screen
            name="Dashboard"
            component={DashboardScreen}
            options={{
              tabBarIcon: ({ focused }) => <TabIcon icon="🏠" label="الرئيسية" focused={focused} />,
            }}
          />
          <Tab.Screen
            name="Orders"
            component={OrdersScreen}
            options={{
              tabBarIcon: ({ focused }) => <TabIcon icon="📦" label="الطلبات" focused={focused} />,
            }}
          />
          <Tab.Screen
            name="Analytics"
            component={AnalyticsScreen}
            options={{
              tabBarIcon: ({ focused }) => <TabIcon icon="📊" label="التحليلات" focused={focused} />,
            }}
          />
          <Tab.Screen
            name="Settings"
            component={SettingsScreen}
            options={{
              tabBarIcon: ({ focused }) => <TabIcon icon="⚙️" label="الإعدادات" focused={focused} />,
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: COLORS.bgSecondary,
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    height: 64,
    paddingBottom: 4,
    paddingTop: 4,
  },
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconText: {
    fontSize: 18,
    marginBottom: 2,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
});

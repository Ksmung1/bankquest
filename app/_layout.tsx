import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { cacheSession, prewarmAppData } from '@/lib/app-data-cache';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { syncUserProfile } from '@/lib/user-profile';
import { PortalReportFab } from '@/components/portal-report-fab';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (!supabase || !hasSupabaseConfig) return;
    const client = supabase;

    const syncFromSession = async () => {
      const { data } = await client.auth.getSession();
      cacheSession(data.session ?? null);
      const user = data.session?.user;
      if (!user?.id) {
        prewarmAppData(null);
        return;
      }
      prewarmAppData(user.id);
      await syncUserProfile({
        userId: user.id,
        email: user.email,
        metadata: user.user_metadata ?? null,
      });
    };

    syncFromSession();

    const { data } = client.auth.onAuthStateChange(async (_event, session) => {
      cacheSession(session ?? null);
      const user = session?.user;
      if (!user?.id) {
        prewarmAppData(null);
        return;
      }
      prewarmAppData(user.id);
      await syncUserProfile({
        userId: user.id,
        email: user.email,
        metadata: user.user_metadata ?? null,
      });
    });

    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="mock-subjects" options={{ headerShown: false }} />
        <Stack.Screen name="mock-test/index" options={{ headerShown: false }} />
        <Stack.Screen name="mock-test/[testid]/index" options={{ headerShown: false }} />
        <Stack.Screen name="saved" options={{ headerShown: false }} />
      </Stack>
      <PortalReportFab />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

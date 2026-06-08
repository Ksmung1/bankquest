import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { cacheSession, getCachedSession, prewarmAppData } from '@/lib/app-data-cache';
import { isPortalLinkedSession, isSSOCallbackPath } from '@/lib/portal-access';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { syncUserProfile } from '@/lib/user-profile';
import { PortalReportFab } from '@/components/portal-report-fab';

export const unstable_settings = {
  anchor: '(tabs)',
};

const GUEST_ACCESSIBLE_PATHS = new Set(['/mock-subjects', '/history', '/profile']);

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const router = useRouter();
  const params = useGlobalSearchParams();
  const inSSOCallback = isSSOCallbackPath(pathname, params);
  const isGuestAccessible = GUEST_ACCESSIBLE_PATHS.has(pathname);
  const [accessReady, setAccessReady] = useState(!hasSupabaseConfig);
  const [hasPortalAccess, setHasPortalAccess] = useState(!hasSupabaseConfig);

  useEffect(() => {
    if (!supabase || !hasSupabaseConfig) return;
    const client = supabase;

    const syncFromSession = async () => {
      const session = await getCachedSession();
      cacheSession(session ?? null);
      const linked = isPortalLinkedSession(session);
      setHasPortalAccess(linked);
      setAccessReady(true);
      const user = session?.user;
      if (!user?.id || !linked) {
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

    const { data } = client.auth.onAuthStateChange(async (event, session) => {
      cacheSession(session ?? null);
      const linked = isPortalLinkedSession(session);
      setHasPortalAccess(linked);
      setAccessReady(true);
      const user = session?.user;
      if (!user?.id || !linked) {
        prewarmAppData(null);
        if (event === 'SIGNED_OUT') {
          setHasPortalAccess(false);
        }
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

  useEffect(() => {
    if (!accessReady) {
      return;
    }

    if (hasPortalAccess && pathname === '/auth' && !inSSOCallback) {
      router.replace('/' as never);
      return;
    }

    if (!hasPortalAccess && pathname !== '/auth' && !inSSOCallback && !isGuestAccessible) {
      router.replace('/auth' as never);
    }
  }, [accessReady, hasPortalAccess, inSSOCallback, isGuestAccessible, pathname, router]);

  if (!accessReady && !isGuestAccessible && !inSSOCallback) {
    return null;
  }

  if (!hasPortalAccess && pathname !== '/auth' && !isGuestAccessible && !inSSOCallback) {
    return null;
  }

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
      {hasPortalAccess ? <PortalReportFab /> : null}
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useGlobalSearchParams, useRouter } from 'expo-router';
import { PortalAccessScreen } from '@/components/portal-access-screen';
import { formatAuthErrorMessage } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

async function waitForBrowserSession(attempts = 10, delayMs = 150) {
  if (!supabase) {
    return null;
  }

  for (let i = 0; i < attempts; i += 1) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user?.id) {
      return data.session;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return null;
}

export default function AuthScreen() {
  const router = useRouter();
  const params = useGlobalSearchParams<{
    code?: string;
    sso?: string;
    sso_error?: string;
    error_description?: string;
  }>();
  const [status, setStatus] = useState<'checking' | 'error' | 'denied'>('checking');
  const [message, setMessage] = useState('Completing your Thanghou SSO sign-in...');

  useEffect(() => {
    let cancelled = false;

    async function completeSSO() {
      if (!supabase) {
        if (cancelled) return;
        setStatus('error');
        setMessage('Supabase is unavailable for BankCore SSO.');
        return;
      }

      const ssoError = typeof params.sso_error === 'string' ? params.sso_error : '';
      if (ssoError) {
        if (cancelled) return;
        setStatus('error');
        setMessage(decodeURIComponent(ssoError));
        return;
      }

      const isSSO = params.sso === '1';
      const code = typeof params.code === 'string' ? params.code : '';
      const hasHashTokens =
        Platform.OS === 'web' &&
        typeof window !== 'undefined' &&
        /(?:^|#|&)access_token=/.test(window.location.hash);

      if (isSSO && code) {
        try {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            throw error;
          }

          if (Platform.OS === 'web' && typeof window !== 'undefined') {
            window.history.replaceState({}, document.title, window.location.pathname);
          }

          if (!cancelled) {
            router.replace('/' as never);
          }
        } catch (error) {
          if (cancelled) return;
          setStatus('error');
          setMessage(formatAuthErrorMessage(error));
        }
        return;
      }

      if (hasHashTokens) {
        try {
          const session = await waitForBrowserSession();

          if (!session?.user?.id) {
            throw new Error('Supabase returned tokens, but no session was established.');
          }

          if (Platform.OS === 'web' && typeof window !== 'undefined') {
            window.history.replaceState({}, document.title, window.location.pathname);
          }

          if (!cancelled) {
            router.replace('/' as never);
          }
        } catch (error) {
          if (cancelled) return;
          setStatus('error');
          setMessage(formatAuthErrorMessage(error));
        }
        return;
      }

      if (!isSSO) {
        if (cancelled) return;
        setStatus('denied');
        return;
      }

      if (cancelled) return;
      setStatus('error');
      setMessage('SSO callback did not include a valid Supabase auth session.');
    }

    completeSSO();

    return () => {
      cancelled = true;
    };
  }, [params.code, params.sso, params.sso_error, router]);

  if (status === 'denied') {
    return <PortalAccessScreen />;
  }

  if (status === 'error') {
    return (
      <PortalAccessScreen
        title="SSO login failed"
        message={message}
        detail="Go back to Thanghou and open BankCore again."
      />
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.title}>Signing you in</Text>
        <Text style={styles.message}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#EEF4FF',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    padding: 28,
    borderRadius: 24,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D9E5FF',
  },
  title: {
    marginTop: 16,
    fontSize: 24,
    fontWeight: '900',
    color: '#14234F',
  },
  message: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
    color: '#5C6B89',
    textAlign: 'center',
  },
});

import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useGlobalSearchParams, useRouter } from 'expo-router';
import { PortalAccessScreen } from '@/components/portal-access-screen';
import { formatAuthErrorMessage } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

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

      if (!isSSO || !code) {
        if (cancelled) return;
        setStatus('denied');
        return;
      }

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

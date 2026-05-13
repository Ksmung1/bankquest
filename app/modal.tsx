import { useEffect, useState } from 'react';
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { checkUsernameAvailability, formatAuthErrorMessage, resendVerificationEmail, sendPasswordReset, shouldOfferResendVerification, submitEmailAuth } from '@/lib/auth';

export default function ModalScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [authMessageTone, setAuthMessageTone] = useState<'error' | 'success'>('success');
  const [showResendVerification, setShowResendVerification] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [usernameMessage, setUsernameMessage] = useState('');
  const webInputReset = Platform.OS === 'web' ? ({ outlineWidth: 0, outlineStyle: 'none', boxShadow: 'none' } as const) : null;

  useEffect(() => {
    async function restoreSession() {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      if (data.session?.user?.id) {
        router.replace('/' as never);
      }
    }
    restoreSession();

    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.id) {
        router.replace('/' as never);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    if (tab !== 'signup') {
      setUsernameStatus('idle');
      setUsernameMessage('');
      return;
    }

    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) {
      setUsernameStatus('idle');
      setUsernameMessage('');
      return;
    }

    if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
      setUsernameStatus('taken');
      setUsernameMessage('Username must be 3 to 24 characters using lowercase letters, numbers, or underscores.');
      return;
    }

    setUsernameStatus('checking');
    setUsernameMessage('Checking username...');
    const timer = setTimeout(() => {
      checkUsernameAvailability(normalizedUsername)
        .then((result) => {
          setUsernameStatus(result.available ? 'available' : 'taken');
          setUsernameMessage(result.available ? 'Username is available.' : (result.reason ?? 'Username is already taken.'));
        })
        .catch(() => {
          setUsernameStatus('idle');
          setUsernameMessage('');
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [tab, username]);

  const handleContinue = async () => {
    if (tab === 'signup' && (usernameStatus === 'checking' || usernameStatus === 'taken')) {
      setAuthMessageTone('error');
      setAuthMessage(usernameStatus === 'checking' ? 'Please wait until username checking finishes.' : 'Username is already taken.');
      return;
    }

    setAuthMessage('');
    setShowResendVerification(false);
    setLoading(true);
    try {
      if (tab === 'login') {
        const result = await submitEmailAuth('login', { email, password });
        if (result.status === 'signed_in') {
          router.replace('/' as never);
        }
      } else {
        const result = await submitEmailAuth('signup', { email, password, phoneNumber, username });
        setAuthMessageTone('success');
        if (result.status === 'already_registered_unverified') {
          setAuthMessage('Your account is already registered. Please log in. If your email is still not verified, resend the verification email below.');
          setTab('login');
        } else {
          setAuthMessage('Signup completed. Check your email, verify your account, then log in with your email and password.');
        }
        setShowResendVerification(shouldOfferResendVerification(result));
        setPassword('');
      }
    } catch (e) {
      setAuthMessageTone('error');
      const message = formatAuthErrorMessage(e);
      setAuthMessage(message);
      setShowResendVerification(shouldOfferResendVerification(message));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setAuthMessage('');
    setShowResendVerification(false);
    setLoading(true);
    try {
      await sendPasswordReset(email);
      setAuthMessageTone('success');
      setAuthMessage('Password reset email sent. Open the link in your email and return to the auth page to set a new password.');
    } catch (e) {
      setAuthMessageTone('error');
      setAuthMessage(formatAuthErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setLoading(true);
    try {
      await resendVerificationEmail(email);
      setAuthMessageTone('success');
      setAuthMessage('Verification email sent. Open your email, verify the account, then log in.');
      setShowResendVerification(true);
    } catch (e) {
      setAuthMessageTone('error');
      setAuthMessage(formatAuthErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.scrollArea}>
        <View style={styles.card}>
          <View style={styles.owlWrap}>
            <Image source={require('@/assets/images/mascot.png')} style={styles.mascot} resizeMode="contain" />
          </View>

          <View style={styles.tabs}>
            <Pressable onPress={() => { setTab('login'); setAuthMessage(''); }} style={[styles.tab, tab === 'login' && styles.tabActive]}>
              <Text style={[styles.tabText, tab === 'login' && styles.tabTextActive]}>Login</Text>
            </Pressable>
            <Pressable onPress={() => { setTab('signup'); setAuthMessage(''); }} style={[styles.tab, tab === 'signup' && styles.tabActive]}>
              <Text style={[styles.tabText, tab === 'signup' && styles.tabTextActive]}>Signup</Text>
            </Pressable>
          </View>

          <View style={styles.form}>
            {tab === 'signup' ? (
              <View style={styles.inputWrap}>
                <TextInput
                  placeholder="Username"
                  placeholderTextColor="#CBD5E1"
                  value={username}
                  onChangeText={(text) => setUsername(text.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                  style={[styles.input, webInputReset as any]}
                  autoCapitalize="none"
                  maxLength={24}
                />
              </View>
            ) : null}
            {tab === 'signup' && usernameMessage ? (
              <Text style={styles.inlineInfoText}>
                {usernameMessage}
              </Text>
            ) : null}
            {tab === 'signup' ? (
              <View style={styles.inputWrap}>
                <TextInput
                  placeholder="Phone number"
                  placeholderTextColor="#CBD5E1"
                  value={phoneNumber}
                  onChangeText={(text) => setPhoneNumber(text.replace(/\D/g, '').slice(0, 10))}
                  style={[styles.input, webInputReset as any]}
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
            ) : null}
            <View style={styles.inputWrap}>
              <TextInput
                placeholder="Email"
                placeholderTextColor="#CBD5E1"
                value={email}
                onChangeText={setEmail}
                style={[styles.input, webInputReset as any]}
                autoCapitalize="none"
              />
              <Text style={styles.inputIcon}>??</Text>
            </View>

            <View style={styles.inputWrap}>
              <TextInput
                placeholder="Password"
                placeholderTextColor="#CBD5E1"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                style={[styles.input, webInputReset as any]}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)}>
                <Text style={styles.inputIcon}>{showPassword ? '??' : '???'}</Text>
              </Pressable>
            </View>

            {tab === 'login' ? (
              <View style={styles.forgotRow}>
                <Pressable onPress={handleForgotPassword}>
                  <Text style={styles.forgotLink}>Forgot Password?</Text>
                </Pressable>
              </View>
            ) : null}

            <Pressable disabled={loading} onPress={handleContinue} style={({ pressed }) => [styles.continueBtn, (pressed || loading) && styles.pressed]}>
              <Text style={styles.continueBtnText}>{loading ? 'Please wait...' : 'Continue'}</Text>
            </Pressable>
            {authMessage ? <Text style={[styles.feedbackText, authMessageTone === 'error' ? styles.feedbackError : styles.feedbackSuccess]}>{authMessage}</Text> : null}
            {showResendVerification ? (
              <Pressable disabled={loading} onPress={handleResendVerification} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>Send verification email</Text>
              </Pressable>
            ) : null}
            {tab === 'signup' ? <Text style={styles.infoText}>Signup creates your account and sends a verification email. After you verify it, come back and log in with your email and password.</Text> : null}

            <Text style={styles.signupText}>
              Need an account?{' '}
              <Text style={styles.signupLink} onPress={() => setTab('signup')}>
                Signup here.
              </Text>
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#EAF3FF',
  },
  scrollArea: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 28,
    shadowColor: '#3B82F6',
    shadowOpacity: 0.13,
    shadowRadius: 24,
    elevation: 4,
  },
  owlWrap: {
    alignItems: 'center',
    marginBottom: 20,
  },
  mascot: {
    width: 96,
    height: 96,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 30,
    padding: 4,
    marginBottom: 24,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 26,
    paddingVertical: 10,
  },
  tabActive: {
    backgroundColor: '#FF6B2C',
  },
  tabText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#64748B',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  form: {
    gap: 14,
  },
  inputWrap: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingLeft: 16,
    paddingRight: 14,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },
  inputIcon: {
    fontSize: 16,
    color: '#CBD5E1',
  },
  forgotRow: {
    alignItems: 'flex-end',
    marginTop: -6,
  },
  forgotLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FF6B2C',
  },
  continueBtn: {
    backgroundColor: '#FF6B2C',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  continueBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  feedbackText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  feedbackError: {
    color: '#DC2626',
  },
  feedbackSuccess: {
    color: '#15803D',
  },
  inlineInfoText: {
    marginTop: -8,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    color: '#475569',
  },
  secondaryAction: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  secondaryActionText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2563EB',
  },
  infoText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#64748B',
    fontWeight: '600',
  },
  signupText: {
    marginTop: 4,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  signupLink: {
    color: '#FF6B2C',
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.86,
  },
});


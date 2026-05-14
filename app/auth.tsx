import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import {
  checkUsernameAvailability,
  formatAuthErrorMessage,
  resendVerificationEmail,
  sendPasswordReset,
  shouldOfferResendVerification,
  submitEmailAuth,
} from '@/lib/auth';

const desktopHero = require('@/assets/images/auth-desktop.png');
const mobileHero = require('@/assets/images/auth-mobile.png');
const brandLogo = require('@/assets/images/logo.jpeg');
const DESKTOP_HERO_RATIO = 1086 / 1448;
const MOBILE_HERO_RATIO = 1254 / 868;

export default function AuthScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [authMessageTone, setAuthMessageTone] = useState<'error' | 'success'>('success');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [showResendVerification, setShowResendVerification] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [usernameMessage, setUsernameMessage] = useState('');
  const webInputReset = Platform.OS === 'web' ? ({ outlineWidth: 0, outlineStyle: 'none', boxShadow: 'none' } as const) : null;

  const isDesktop = width >= 1100;
  const isMobile = width < 720;
  const isSignup = tab === 'signup' && !recoveryMode;

  useEffect(() => {
    async function restoreSession() {
      if (!supabase) return;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const search = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const hashAccessToken = hash.get('access_token');
        const hashRefreshToken = hash.get('refresh_token');
        const hashType = hash.get('type');
        const code = search.get('code');
        const isSSO = search.get('sso') === '1';
        const type = search.get('type') ?? hashType;
        const ssoError = search.get('sso_error');
        const errorDescription = ssoError ?? search.get('error_description') ?? hash.get('error_description');

        if (errorDescription) {
          setAuthMessageTone('error');
          setAuthMessage(decodeURIComponent(errorDescription));
        }

        if (code && isSSO) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error) {
            setAuthMessageTone('success');
            setAuthMessage('Signed in with SSO. Redirecting to your dashboard...');
            window.history.replaceState({}, document.title, window.location.pathname);
            router.replace('/' as never);
            return;
          }
          setAuthMessageTone('error');
          setAuthMessage(formatAuthErrorMessage(error));
        }

        if (type === 'recovery' && code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error) {
            setRecoveryMode(true);
            setTab('login');
            setAuthMessageTone('success');
            setAuthMessage('Set your new password below.');
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
          }
        }

        if (hashAccessToken && hashRefreshToken && type === 'recovery') {
          const { error } = await supabase.auth.setSession({
            access_token: hashAccessToken,
            refresh_token: hashRefreshToken,
          });
          if (!error) {
            setRecoveryMode(true);
            setTab('login');
            setAuthMessageTone('success');
            setAuthMessage('Set your new password below.');
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
          }
        }
      }

      const { data } = await supabase.auth.getSession();
      if (data.session?.user?.id && !recoveryMode) {
        router.replace('/' as never);
      }
    }

    restoreSession();

    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true);
        setAuthMessageTone('success');
        setAuthMessage('Set your new password below.');
        return;
      }

      if (session?.user?.id && !recoveryMode) {
        router.replace('/' as never);
      }
    });

    return () => data.subscription.unsubscribe();
  }, [recoveryMode, router]);

  useEffect(() => {
    if (tab !== 'signup' || recoveryMode) {
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
  }, [recoveryMode, tab, username]);

  const switchTab = (nextTab: 'login' | 'signup') => {
    setRecoveryMode(false);
    setTab(nextTab);
    setAuthMessage('');
    setShowResendVerification(false);
  };

  const handleForgotPassword = async () => {
    setShowResendVerification(false);
    setAuthMessage('');
    setLoading(true);
    try {
      await sendPasswordReset(email);
      setAuthMessageTone('success');
      setAuthMessage('Password reset email sent. Open the link in your email and you will return here to set a new password.');
    } catch (e) {
      setAuthMessageTone('error');
      setAuthMessage(formatAuthErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRecoveryUpdate = async () => {
    if (!supabase) return;
    if (password.length < 8) {
      setAuthMessageTone('error');
      setAuthMessage('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setAuthMessageTone('error');
      setAuthMessage('Passwords do not match.');
      return;
    }

    setAuthMessage('');
    setShowResendVerification(false);
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setRecoveryMode(false);
      setConfirmPassword('');
      setPassword('');
      await supabase.auth.signOut();
      setTab('login');
      setAuthMessageTone('success');
      setAuthMessage('Password updated successfully. You can now log in with your new password.');
    } catch (e) {
      setAuthMessageTone('error');
      setAuthMessage(formatAuthErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

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
          setTab('login');
          setAuthMessage('Your account is already registered. Please log in. If your email is still not verified, resend the verification email below.');
        } else {
          setAuthMessage('Signup completed. Please check your email and verify your account.');
        }
        setShowResendVerification(shouldOfferResendVerification(result));
        setPassword('');
      }
    } catch (e) {
      const message = formatAuthErrorMessage(e);
      setAuthMessageTone('error');
      setAuthMessage(message);
      setShowResendVerification(shouldOfferResendVerification(message));
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

  const badgeText = recoveryMode ? 'Password recovery' : isSignup ? 'Create account' : 'Secure access';
  const titleText = recoveryMode ? 'Set a new password' : isSignup ? 'Start your BankCore journey' : 'Welcome back';
  const subtitleText = recoveryMode
    ? 'Your recovery link is active. Choose a strong password and update your account securely.'
    : isSignup
      ? 'Create your account to access mocks, track improvement, and build a stronger exam routine.'
      : 'Log in to continue your preparation, track your progress, and pick up exactly where you left off.';
  const submitText = loading ? 'Please wait...' : recoveryMode ? 'Update Password' : isSignup ? 'Create Account' : 'Continue';
  const helperText = recoveryMode
    ? 'Use at least 8 characters. After updating, you will log in again with the new password.'
    : isSignup
      ? 'Signup creates your account and sends a verification email before your first login.'
      : 'Use the same email and password you verified with Supabase.';

  const cardStyles = [
    styles.authCard,
    isDesktop ? styles.authCardDesktop : styles.authCardMobile,
  ];

  return (
    <View style={styles.page}>
      <View style={styles.backgroundGlowTop} />
      <View style={styles.backgroundGlowBottom} />
      <ScrollView
        contentContainerStyle={[
          styles.scrollArea,
          isDesktop ? styles.scrollDesktop : styles.scrollMobile,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.shell, isDesktop ? styles.shellDesktop : styles.shellMobile]}>
          <View
            style={[
              styles.heroPanel,
              isDesktop ? styles.heroPanelDesktop : styles.heroPanelMobile,
            ]}
          >
            <Image
              source={isDesktop ? desktopHero : mobileHero}
              style={isDesktop ? [styles.heroImageDesktop, { aspectRatio: DESKTOP_HERO_RATIO }] : [styles.heroImageMobile, { aspectRatio: MOBILE_HERO_RATIO }]}
              resizeMode="contain"
            />
          </View>

          <View style={[styles.authPanel, isDesktop ? styles.authPanelDesktop : styles.authPanelMobile]}>
            <View style={cardStyles}>
              <View style={styles.authTopbar}>
                <View style={styles.authBadge}>
                  <Text style={styles.authBadgeText}>{badgeText}</Text>
                </View>
                <Pressable onPress={() => router.replace('/' as never)} style={styles.closeButton} hitSlop={8}>
                  <MaterialCommunityIcons name="close" size={20} color="#475569" />
                </Pressable>
              </View>

              <View style={styles.brandRow}>
                <Image source={brandLogo} style={styles.brandLogo} resizeMode="cover" />
                <Text style={styles.brandText}>
                  Bank<Text style={styles.brandAccent}>Core</Text>
                </Text>
              </View>

              <Text style={styles.heading}>{titleText}</Text>
              <Text style={styles.subheading}>{subtitleText}</Text>

              {!recoveryMode ? (
                <View style={styles.tabs}>
                  <Pressable
                    onPress={() => switchTab('login')}
                    style={[styles.tabButton, tab === 'login' && styles.tabButtonActive]}
                  >
                    <Text style={[styles.tabButtonText, tab === 'login' && styles.tabButtonTextActive]}>Login</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => switchTab('signup')}
                    style={[styles.tabButton, tab === 'signup' && styles.tabButtonActive]}
                  >
                    <Text style={[styles.tabButtonText, tab === 'signup' && styles.tabButtonTextActive]}>Signup</Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.form}>
                {isSignup ? (
                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>Username</Text>
                    <View style={styles.inputWrap}>
                      <MaterialCommunityIcons name="at" size={18} color="#94A3B8" />
                      <TextInput
                        placeholder="Choose a username"
                        placeholderTextColor="#94A3B8"
                        value={username}
                        onChangeText={(text) => setUsername(text.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                        style={[styles.input, webInputReset as any]}
                        autoCapitalize="none"
                        maxLength={24}
                      />
                    </View>
                    {usernameMessage ? (
                      <Text
                        style={[
                          styles.inlineInfoText,
                          usernameStatus === 'available' ? styles.inlineInfoSuccess : usernameStatus === 'taken' ? styles.inlineInfoError : null,
                        ]}
                      >
                        {usernameMessage}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {isSignup ? (
                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>Phone Number</Text>
                    <View style={styles.inputWrap}>
                      <MaterialCommunityIcons name="phone-outline" size={18} color="#94A3B8" />
                      <TextInput
                        placeholder="Enter 10-digit phone number"
                        placeholderTextColor="#94A3B8"
                        value={phoneNumber}
                        onChangeText={(text) => setPhoneNumber(text.replace(/\D/g, '').slice(0, 10))}
                        style={[styles.input, webInputReset as any]}
                        keyboardType="number-pad"
                        maxLength={10}
                      />
                    </View>
                  </View>
                ) : null}

                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>{recoveryMode ? 'Account Email' : 'Email'}</Text>
                  <View style={styles.inputWrap}>
                    <MaterialCommunityIcons name="email-outline" size={18} color="#94A3B8" />
                    <TextInput
                      placeholder="you@example.com"
                      placeholderTextColor="#94A3B8"
                      value={email}
                      onChangeText={setEmail}
                      style={[styles.input, webInputReset as any]}
                      autoCapitalize="none"
                      editable={!recoveryMode}
                    />
                  </View>
                </View>

                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>Password</Text>
                  <View style={styles.inputWrap}>
                    <MaterialCommunityIcons name="lock-outline" size={18} color="#94A3B8" />
                    <TextInput
                      placeholder={recoveryMode ? 'Enter your new password' : 'Enter your password'}
                      placeholderTextColor="#94A3B8"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                      style={[styles.input, webInputReset as any]}
                    />
                    <Pressable onPress={() => setShowPassword((value) => !value)} hitSlop={8}>
                      <Text style={styles.eyeText}>{showPassword ? 'Hide' : 'Show'}</Text>
                    </Pressable>
                  </View>
                </View>

                {recoveryMode ? (
                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>Confirm New Password</Text>
                    <View style={styles.inputWrap}>
                      <MaterialCommunityIcons name="lock-check-outline" size={18} color="#94A3B8" />
                      <TextInput
                        placeholder="Confirm your new password"
                        placeholderTextColor="#94A3B8"
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        secureTextEntry={!showConfirmPassword}
                        style={[styles.input, webInputReset as any]}
                      />
                      <Pressable onPress={() => setShowConfirmPassword((value) => !value)} hitSlop={8}>
                        <Text style={styles.eyeText}>{showConfirmPassword ? 'Hide' : 'Show'}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {tab === 'login' && !recoveryMode ? (
                  <View style={[styles.rowActions, isMobile && styles.rowActionsMobile]}>
                    <Text style={styles.rowHint}>Use the same email you registered with.</Text>
                    <Pressable onPress={handleForgotPassword}>
                      <Text style={styles.forgotLink}>Forgot password?</Text>
                    </Pressable>
                  </View>
                ) : null}

                <Pressable
                  disabled={loading}
                  onPress={recoveryMode ? handleRecoveryUpdate : handleContinue}
                  style={({ pressed }) => [styles.submitButton, (pressed || loading) && styles.pressed]}
                >
                  <Text style={styles.submitButtonText}>{submitText}</Text>
                </Pressable>

                {authMessage ? (
                  <View style={[styles.feedbackBox, authMessageTone === 'error' ? styles.feedbackErrorBox : styles.feedbackSuccessBox]}>
                    <Text style={[styles.feedbackText, authMessageTone === 'error' ? styles.feedbackErrorText : styles.feedbackSuccessText]}>
                      {authMessage}
                    </Text>
                  </View>
                ) : null}

                {showResendVerification && !recoveryMode ? (
                  <Pressable disabled={loading} onPress={handleResendVerification} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>Send verification email</Text>
                  </Pressable>
                ) : null}

                <Text style={styles.helperText}>{helperText}</Text>

                {!recoveryMode ? (
                  <Text style={styles.switchText}>
                    {tab === 'login' ? 'Need an account? ' : 'Already have an account? '}
                    <Text style={styles.switchLink} onPress={() => switchTab(tab === 'login' ? 'signup' : 'login')}>
                      {tab === 'login' ? 'Create one' : 'Log in'}
                    </Text>
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#EEF4FF',
  },
  backgroundGlowTop: {
    position: 'absolute',
    top: -100,
    left: -80,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(99,102,241,0.16)',
  },
  backgroundGlowBottom: {
    position: 'absolute',
    right: -120,
    bottom: -80,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: 'rgba(96,165,250,0.16)',
  },
  scrollArea: {
    flexGrow: 1,
  },
  scrollDesktop: {
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  scrollMobile: {
    paddingBottom: 24,
  },
  shell: {
    flex: 1,
  },
  shellDesktop: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
  },
  shellMobile: {
    minHeight: '100%',
  },
  heroPanel: {
    overflow: 'hidden',
  },
  heroPanelDesktop: {
    flex: 1.134,
    backgroundColor: 'transparent',
    borderRadius: 32,
    overflow: 'hidden',
  },
  heroPanelMobile: {
    backgroundColor: '#DCE9FF',
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  heroImageDesktop: {
    width: '100%',
    height: undefined,
  },
  heroImageMobile: {
    width: '100%',
    height: undefined,
  },
  authPanel: {
    justifyContent: 'center',
  },
  authPanelDesktop: {
    flex: 0.866,
    minWidth: 420,
    paddingVertical: 0,
  },
  authPanelMobile: {
    marginTop: 16,
    paddingHorizontal: 14,
  },
  authCard: {
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.9)',
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#3B82F6',
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 8,
  },
  authCardDesktop: {
    borderRadius: 32,
    paddingHorizontal: 30,
    paddingVertical: 30,
  },
  authCardMobile: {
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 22,
  },
  authTopbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  authBadge: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(129,140,248,0.24)',
    backgroundColor: '#EEF2FF',
  },
  authBadgeText: {
    color: '#4F46E5',
    fontSize: 14,
    fontWeight: '700',
  },
  closeButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 24,
  },
  brandLogo: {
    width: 48,
    height: 48,
    borderRadius: 14,
  },
  brandText: {
    color: '#0F172A',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -1.2,
  },
  brandAccent: {
    color: '#4E68FF',
  },
  heading: {
    color: '#0B132B',
    fontSize: 38,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -1.8,
    marginBottom: 12,
  },
  subheading: {
    color: '#5B6685',
    fontSize: 15,
    lineHeight: 25,
    marginBottom: 24,
  },
  tabs: {
    flexDirection: 'row',
    padding: 6,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 22,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 13,
  },
  tabButtonActive: {
    backgroundColor: '#5F58FF',
  },
  tabButtonText: {
    color: '#64748B',
    fontSize: 15,
    fontWeight: '700',
  },
  tabButtonTextActive: {
    color: '#FFFFFF',
  },
  form: {
    gap: 14,
  },
  fieldBlock: {
    gap: 8,
  },
  fieldLabel: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
  },
  inputWrap: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  input: {
    flex: 1,
    minHeight: 56,
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '500',
  },
  eyeText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '700',
  },
  inlineInfoText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748B',
  },
  inlineInfoSuccess: {
    color: '#4ADE80',
  },
  inlineInfoError: {
    color: '#FF7B8E',
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowActionsMobile: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  rowHint: {
    flex: 1,
    color: '#64748B',
    fontSize: 13,
    lineHeight: 20,
  },
  forgotLink: {
    color: '#5F58FF',
    fontSize: 14,
    fontWeight: '600',
  },
  submitButton: {
    marginTop: 8,
    borderRadius: 20,
    paddingVertical: 17,
    alignItems: 'center',
    backgroundColor: '#5F58FF',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  feedbackBox: {
    marginTop: 2,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
  },
  feedbackSuccessBox: {
    backgroundColor: 'rgba(74,222,128,0.10)',
    borderColor: 'rgba(74,222,128,0.20)',
  },
  feedbackErrorBox: {
    backgroundColor: 'rgba(255,123,142,0.10)',
    borderColor: 'rgba(255,123,142,0.18)',
  },
  feedbackText: {
    fontSize: 13,
    lineHeight: 21,
    fontWeight: '600',
  },
  feedbackSuccessText: {
    color: '#166534',
  },
  feedbackErrorText: {
    color: '#BE123C',
  },
  secondaryButton: {
    marginTop: 12,
    borderRadius: 18,
    alignItems: 'center',
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#D6DBFF',
    backgroundColor: '#F8FAFF',
  },
  secondaryButtonText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
  },
  helperText: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 21,
    marginTop: 2,
  },
  switchText: {
    marginTop: 2,
    textAlign: 'center',
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
  },
  switchLink: {
    color: '#5F58FF',
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.84,
  },
});

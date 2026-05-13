import { useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { checkUsernameAvailability, formatAuthErrorMessage, resendVerificationEmail, shouldOfferResendVerification, submitEmailAuth } from '@/lib/auth';

type Props = {
  visible: boolean;
  onClose?: () => void;
  onAuthed: () => void;
};

export function InlineAuthModal({ visible, onClose, onAuthed }: Props) {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [authMessageTone, setAuthMessageTone] = useState<'error' | 'success'>('success');
  const [showResendVerification, setShowResendVerification] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [usernameMessage, setUsernameMessage] = useState('');
  const webInputReset = Platform.OS === 'web' ? ({ outlineWidth: 0, outlineStyle: 'none', boxShadow: 'none' } as const) : null;

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

  const submit = async () => {
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
          onAuthed();
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
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Continue to Mock Tests</Text>
            {onClose ? (
              <Pressable onPress={onClose}>
                <MaterialCommunityIcons name="close" size={18} color="#64748B" />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.tabs}>
            <Pressable onPress={() => { setTab('login'); setAuthMessage(''); }} style={[styles.tab, tab === 'login' && styles.tabActive]}><Text style={[styles.tabText, tab === 'login' && styles.tabTextActive]}>Login</Text></Pressable>
            <Pressable onPress={() => { setTab('signup'); setAuthMessage(''); }} style={[styles.tab, tab === 'signup' && styles.tabActive]}><Text style={[styles.tabText, tab === 'signup' && styles.tabTextActive]}>Signup</Text></Pressable>
          </View>

          {tab === 'signup' ? (
            <View style={styles.field}>
              <TextInput
                value={username}
                onChangeText={(text) => setUsername(text.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                autoCapitalize="none"
                maxLength={24}
                placeholder="Username"
                placeholderTextColor="#94A3B8"
                style={[styles.input, webInputReset as any]}
              />
            </View>
          ) : null}
          {tab === 'signup' && usernameMessage ? (
            <Text style={styles.infoText}>
              {usernameMessage}
            </Text>
          ) : null}
          {tab === 'signup' ? (
            <View style={styles.field}>
              <TextInput
                value={phoneNumber}
                onChangeText={(text) => setPhoneNumber(text.replace(/\D/g, '').slice(0, 10))}
                keyboardType="number-pad"
                maxLength={10}
                placeholder="Phone number"
                placeholderTextColor="#94A3B8"
                style={[styles.input, webInputReset as any]}
              />
            </View>
          ) : null}
          <View style={styles.field}>
            <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" placeholder="Email" placeholderTextColor="#94A3B8" style={[styles.input, webInputReset as any]} />
          </View>
          <View style={styles.field}>
            <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" placeholderTextColor="#94A3B8" style={[styles.input, webInputReset as any]} />
          </View>

          <Pressable onPress={submit} disabled={loading} style={({ pressed }) => [styles.btn, (pressed || loading) && styles.pressed]}>
            <Text style={styles.btnText}>{loading ? 'Please wait...' : tab === 'login' ? 'Login' : 'Signup'}</Text>
          </Pressable>
          {authMessage ? <Text style={[styles.infoText, authMessageTone === 'error' ? styles.feedbackError : styles.feedbackSuccess]}>{authMessage}</Text> : null}
          {showResendVerification ? (
            <Pressable disabled={loading} onPress={handleResendVerification} style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>Send verification email</Text>
            </Pressable>
          ) : null}
          {tab === 'signup' ? <Text style={styles.infoText}>Signup creates your account and sends a verification email. After you verify it, come back and log in with your email and password.</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.5)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: 14, padding: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '900', color: '#1E293B' },
  tabs: { flexDirection: 'row', marginTop: 12, backgroundColor: '#F1F5F9', borderRadius: 99, padding: 4 },
  tab: { flex: 1, borderRadius: 99, paddingVertical: 8, alignItems: 'center' },
  tabActive: { backgroundColor: '#FF6B2C' },
  tabText: { fontSize: 13, fontWeight: '800', color: '#64748B' },
  tabTextActive: { color: '#fff' },
  field: { marginTop: 10, borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 10, backgroundColor: '#F8FAFC', paddingHorizontal: 12 },
  input: { height: 44, color: '#1E293B', fontSize: 14, fontWeight: '600' },
  btn: { marginTop: 12, backgroundColor: '#FF6B2C', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  infoText: { marginTop: 8, fontSize: 11, lineHeight: 16, color: '#64748B', fontWeight: '600' },
  feedbackError: { color: '#DC2626' },
  feedbackSuccess: { color: '#15803D' },
  secondaryAction: { marginTop: 6, alignItems: 'center' },
  secondaryActionText: { fontSize: 12, fontWeight: '800', color: '#2563EB' },
  pressed: { opacity: 0.86 },
});

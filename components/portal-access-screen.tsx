import * as Linking from 'expo-linking';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getPortalEntryUrl } from '@/lib/portal-access';

type Props = {
  title?: string;
  message?: string;
  detail?: string;
};

export function PortalAccessScreen({
  title = 'No access permission',
  message = 'BankCore is available only to verified Testers.',
  detail = 'Open the project from Thanghou to continue.',
}: Props) {
  const portalUrl = getPortalEntryUrl();

  const openPortal = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.href = portalUrl;
      return;
    }

    void Linking.openURL(portalUrl);
  };

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons name="shield-lock-outline" size={34} color="#2563EB" />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <Text style={styles.detail}>{detail}</Text>
        <Pressable onPress={openPortal} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={styles.buttonText}>Become a testor</Text>
        </Pressable>
        <Text style={styles.linkText}>{portalUrl}</Text>
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
    maxWidth: 460,
    borderRadius: 28,
    padding: 28,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D9E5FF',
    alignItems: 'center',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF1FF',
    marginBottom: 18,
  },
  title: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '900',
    color: '#14234F',
    textAlign: 'center',
  },
  message: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '700',
    color: '#42506B',
    textAlign: 'center',
  },
  detail: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 22,
    color: '#64748B',
    textAlign: 'center',
  },
  button: {
    marginTop: 22,
    minWidth: 220,
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: 'center',
    backgroundColor: '#2563EB',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  linkText: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
    color: '#6B7A99',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.86,
  },
});

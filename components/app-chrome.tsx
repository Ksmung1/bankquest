import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import { getCachedSession, getCachedUserProfile } from '@/lib/app-data-cache';

export type NavKey = 'home' | 'tests' | 'history' | 'profile';

function MobileBottomNav({ active, onChange }: { active: NavKey; onChange: (key: NavKey) => void }) {
  const items: { key: NavKey; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
    { key: 'home', label: 'Home', icon: 'home' },
    { key: 'tests', label: 'Tests', icon: 'file-document-outline' },
    { key: 'history', label: 'Stats', icon: 'chart-bar' },
    { key: 'profile', label: 'Profile', icon: 'account-outline' },
  ];

  return (
    <View style={styles.mobileNav}>
      {items.map((item) => (
        <Pressable
          key={item.key}
          onPress={() => onChange(item.key)}
          style={({ pressed }) => [styles.mobileNavItem, active === item.key && styles.mobileNavItemActive, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name={item.icon} size={20} color={active === item.key ? '#2563FF' : '#63708C'} />
          <Text style={[styles.mobileNavLabel, active === item.key && styles.mobileNavLabelActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function DesktopSidebar({
  active,
  onChange,
  userName,
  avatarUrl,
}: {
  active: NavKey;
  onChange: (key: NavKey) => void;
  userName: string;
  avatarUrl: string | null;
}) {
  const items: { key: NavKey; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
    { key: 'home', label: 'Home', icon: 'home' },
    { key: 'tests', label: 'Tests', icon: 'file-document-outline' },
    { key: 'history', label: 'History', icon: 'history' },
    { key: 'profile', label: 'Profile', icon: 'account-outline' },
  ];

  return (
    <View style={styles.sidebar}>
      <View style={styles.logo}>
        <Image source={require('@/assets/images/logo.jpeg')} style={styles.logoImage} />
        <Text style={styles.logoText}>
          Bank<Text style={styles.logoAccent}>Core</Text>
        </Text>
      </View>

      <View style={styles.menu}>
        {items.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={({ pressed }) => [styles.menuItem, active === item.key && styles.menuItemActive, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name={item.icon} size={22} color={active === item.key ? '#2563FF' : '#13254C'} />
            <Text style={[styles.menuItemText, active === item.key && styles.menuItemTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.profileCard}>
        <View style={styles.profileTop}>
          <Image source={avatarUrl ? { uri: avatarUrl } : require('@/assets/images/profile.png')} style={styles.profileAvatar} />
          <View style={styles.profileTextWrap}>
            <Text style={styles.profileName} numberOfLines={1}>{userName}</Text>
            <Text style={styles.profileSubtitle}>Your BankCore profile</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

export function useAppNavigation() {
  const router = useRouter();

  return (key: NavKey) => {
    if (key === 'home') {
      router.push('/(tabs)' as never);
      return;
    }
    if (key === 'tests') {
      router.push('/mock-subjects' as never);
      return;
    }
    if (key === 'history') {
      router.push('/history' as never);
      return;
    }
    router.push('/profile' as never);
  };
}

export function AppChrome({ active, children }: { active: NavKey; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1200;
  const navigate = useAppNavigation();

  const [userName, setUserName] = useState('User');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const loadSidebarData = useCallback(async () => {
    try {
      const session = await getCachedSession();
      const userId = session?.user?.id ?? null;
      if (!userId) {
        setUserName('User');
        setAvatarUrl(null);
        return;
      }

      const profile = await getCachedUserProfile(userId);
      const metaUsername =
        (session?.user?.user_metadata?.username as string | undefined) ??
        session?.user?.email?.split('@')[0];
      const metaAvatar =
        (session?.user?.user_metadata?.avatar_url as string | undefined) ??
        (session?.user?.user_metadata?.picture as string | undefined) ??
        null;

      setUserName(profile.displayName || profile.username || metaUsername || 'User');
      setAvatarUrl(profile.avatarUrl ?? metaAvatar);
    } catch (error) {
      console.error('Failed to load app chrome sidebar data', error);
      setUserName('User');
      setAvatarUrl(null);
    }
  }, []);

  useEffect(() => {
    void loadSidebarData();
  }, [loadSidebarData]);

  useFocusEffect(
    useCallback(() => {
      void loadSidebarData();
      return undefined;
    }, [loadSidebarData])
  );

  return (
    <View style={styles.page}>
      <View style={styles.wrapper}>
        {isDesktop ? (
          <DesktopSidebar
            active={active}
            onChange={navigate}
            userName={userName}
            avatarUrl={avatarUrl}
          />
        ) : null}
        <View style={styles.main}>
          <View style={[styles.content, !isDesktop && styles.contentWithBottomNav]}>{children}</View>
          {!isDesktop ? <MobileBottomNav active={active} onChange={navigate} /> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#F4F7FF',
  },
  wrapper: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 280,
    backgroundColor: '#FFFFFF',
    padding: 22,
    borderRightWidth: 1,
    borderRightColor: '#E6ECFA',
  },
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 34,
  },
  logoImage: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: '#FFE4C5',
  },
  logoText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#13254C',
  },
  logoAccent: {
    color: '#4C7DFF',
  },
  menu: {
    gap: 14,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 22,
  },
  menuItemActive: {
    backgroundColor: '#EAF1FF',
  },
  menuItemText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#13254C',
  },
  menuItemTextActive: {
    color: '#2563FF',
  },
  profileCard: {
    marginTop: 'auto',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6ECFA',
    borderRadius: 34,
    padding: 22,
    shadowColor: '#3B5998',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
  },
  profileTop: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 16,
  },
  profileAvatar: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 5,
    borderColor: '#FFD55C',
  },
  profileTextWrap: {
    minWidth: 0,
  },
  profileName: {
    fontSize: 28,
    fontWeight: '900',
    color: '#13254C',
    lineHeight: 30,
  },
  profileSubtitle: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: '700',
    color: '#63708C',
  },
  main: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  contentWithBottomNav: {
    paddingBottom: 96,
  },
  mobileNav: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 30,
    elevation: 6,
  },
  mobileNavItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 10,
    minWidth: 64,
  },
  mobileNavItemActive: {
    backgroundColor: '#EDF3FF',
  },
  mobileNavLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#63708C',
  },
  mobileNavLabelActive: {
    color: '#2563FF',
  },
  pressed: {
    opacity: 0.82,
  },
});

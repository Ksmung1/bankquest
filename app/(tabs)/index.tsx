import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Image as ExpoImage } from 'expo-image';
import { Asset } from 'expo-asset';

import {
  cacheSession,
  clearAppDataCache,
  getCachedSession,
  getCachedUserDashboardData,
  getCachedUserProfile,
} from '@/lib/app-data-cache';
import { getPausedMockAttempt, type PausedMockAttempt } from '@/lib/mock-test-resume';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';

type Mode = 'mobile' | 'tablet' | 'desktop';
type NavKey = 'home' | 'tests' | 'history' | 'profile';

type UserPerformance = {
  accuracyPct: number;
  averageScore: number;
  testsCompleted: number;
  totalTimeSeconds: number;
};

type RecentActivityItem = {
  id: string;
  title: string;
  scoreLabel: string;
  timeLabel: string;
};

type WeeklyPoint = {
  day: string;
  count: number;
};

const emptyWeeklyPoints: WeeklyPoint[] = [
  { day: 'S', count: 0 },
  { day: 'M', count: 0 },
  { day: 'T', count: 0 },
  { day: 'W', count: 0 },
  { day: 'T', count: 0 },
  { day: 'F', count: 0 },
  { day: 'S', count: 0 },
];

const defaultPerformance: UserPerformance = {
  accuracyPct: 0,
  averageScore: 0,
  testsCompleted: 0,
  totalTimeSeconds: 0,
};

const journeyStages = [
  { key: 'rookie', label: 'Rookie', image: require('@/assets/images/rookie.png'), colors: ['#FFD56A', '#FFB347'] },
  { key: 'challenger', label: 'Challenger', image: require('@/assets/images/challenger.png'), colors: ['#8BC8FF', '#4C7DFF'] },
  { key: 'warrior', label: 'Warrior', image: require('@/assets/images/warrior.png'), colors: ['#C7A7FF', '#8F4DFF'] },
  { key: 'champion', label: 'Champion', image: require('@/assets/images/champion.png'), colors: ['#FF9AB7', '#FF5C97'] },
  { key: 'legend', label: 'Legend', image: require('@/assets/images/legend.png'), colors: ['#94E3A8', '#48C774'] },
];

const heroSource = require('@/assets/images/hero.png');
const heroAsset = Asset.fromModule(heroSource);

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}min`;
  return `${hours}h ${minutes}min`;
}

function getRankLabel(averageScore: number) {
  if (averageScore > 1000) return 'Legend';
  if (averageScore >= 500) return 'Champion';
  if (averageScore > 200) return 'Warrior';
  if (averageScore >= 100) return 'Challenger';
  return 'Rookie';
}

function getRankStage(averageScore: number) {
  const label = getRankLabel(averageScore).toLowerCase();
  return journeyStages.find((stage) => stage.key === label) ?? journeyStages[0];
}

function Ribbon({ label, tone, isMobile = false }: { label: string; tone: 'blue' | 'purple' | 'pink'; isMobile?: boolean }) {
  return (
    <View
      style={[
        styles.ribbon,
        tone === 'blue' && styles.ribbonBlue,
        tone === 'purple' && styles.ribbonPurple,
        tone === 'pink' && styles.ribbonPink,
        isMobile && styles.ribbonMobile,
      ]}
    >
      <Text style={[styles.ribbonText, isMobile && styles.ribbonTextMobile]}>{label}</Text>
    </View>
  );
}

function SidebarNav({
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

function Hero() {
  return (
    <ExpoImage
      source={heroSource}
      contentFit="contain"
      contentPosition="center"
      style={[styles.heroImage, { aspectRatio: heroAsset.width / heroAsset.height }]}
    />
  );
}

function QuickAction({
  onPress,
  title,
  subtitle,
  isMobile,
}: {
  onPress: () => void;
  title: string;
  subtitle?: string;
  isMobile: boolean;
}) {
  const isContinueCard = Boolean(subtitle);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.quick,
        isMobile && styles.quickMobile,
        isMobile && isContinueCard && styles.quickMobileCompact,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.quickCopy}>
        <Text style={[styles.quickTitle, isMobile && styles.quickTitleMobile, isMobile && isContinueCard && styles.quickTitleMobileCompact]}>{title}</Text>
        {subtitle ? (
          <Text
            style={[styles.quickSubtitle, styles.quickSubtitleMobile, isMobile && isContinueCard && styles.quickSubtitleMobileCompact]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.quickArrow, isMobile && styles.quickArrowMobile, isMobile && isContinueCard && styles.quickArrowMobileCompact]}>➜</Text>
    </Pressable>
  );
}

function PerformanceCard({ performance, isMobile }: { performance: UserPerformance; isMobile: boolean }) {
  return (
    <View style={styles.panel}>
      <Ribbon label="MY PERFORMANCE" tone="blue" isMobile={isMobile} />
      <View style={[styles.performanceGrid, isMobile && styles.performanceGridMobile]}>
        <View style={[styles.perfItem, isMobile && styles.perfItemMobile]}>
          <View style={[styles.circle, isMobile && styles.circleMobile]}>
            <Text style={[styles.circleValue, isMobile && styles.circleValueMobile]}>{performance.accuracyPct}%</Text>
            <Text style={[styles.circleLabel, isMobile && styles.circleLabelMobile]}>Accuracy</Text>
          </View>
        </View>
        <View style={[styles.perfItem, isMobile && styles.perfItemMobile]}>
          <Text style={[styles.perfEmoji, isMobile && styles.perfEmojiMobile]}>📋</Text>
          <Text style={[styles.perfValue, isMobile && styles.perfValueMobile]}>{performance.testsCompleted}</Text>
          <Text style={[styles.perfLabel, isMobile && styles.perfLabelMobile]}>Tests Completed</Text>
        </View>
        <View style={[styles.perfItem, isMobile && styles.perfItemMobile]}>
          <Text style={[styles.perfEmoji, isMobile && styles.perfEmojiMobile]}>⏰</Text>
          <Text style={[styles.perfValue, isMobile && styles.perfValueMobile]}>{formatDuration(performance.totalTimeSeconds)}</Text>
          <Text style={[styles.perfLabel, isMobile && styles.perfLabelMobile]}>Total Time</Text>
        </View>
      </View>
    </View>
  );
}

function JourneyCard({ performance, isMobile }: { performance: UserPerformance; isMobile: boolean }) {
  const currentRank = getRankStage(performance.averageScore);
  const stageIndex = Math.max(0, journeyStages.findIndex((stage) => stage.key === currentRank.key));
  const [mobileRankIndex, setMobileRankIndex] = useState(stageIndex);

  useEffect(() => {
    setMobileRankIndex(stageIndex);
  }, [stageIndex]);

  return (
    <View style={styles.panel}>
      <Ribbon label="YOUR JOURNEY" tone="purple" isMobile={isMobile} />
      {isMobile ? (
        <View style={styles.mobileJourney}>
          <Pressable
            onPress={() => setMobileRankIndex((current) => Math.max(0, current - 1))}
            disabled={mobileRankIndex === 0}
            style={({ pressed }) => [
              styles.mobileJourneyArrow,
              mobileRankIndex === 0 && styles.mobileJourneyArrowDisabled,
              pressed && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons name="chevron-left" size={24} color={mobileRankIndex === 0 ? '#B8C3D9' : '#13254C'} />
          </Pressable>

          {journeyStages
            .filter((_, index) => index === mobileRankIndex)
            .map((stage, index) => {
              const actualIndex = mobileRankIndex;
              const unlocked = actualIndex <= stageIndex;
              const isCurrent = actualIndex === stageIndex;
              return (
                <View key={stage.key} style={styles.mobileJourneyCard}>
                  <View style={styles.mobileJourneyImageWrap}>
                    <Image
                      source={stage.image}
                      style={[styles.mobileJourneyImage, isCurrent && styles.mobileJourneyImageCurrent, !unlocked && styles.chestImageLocked]}
                      resizeMode="contain"
                    />
                  </View>
                  <Text style={[styles.mobileJourneyLabel, isCurrent && styles.mobileJourneyLabelCurrent, !unlocked && styles.chestLabelLocked]}>
                    {stage.label}
                  </Text>
                </View>
              );
            })}

          <Pressable
            onPress={() => setMobileRankIndex((current) => Math.min(journeyStages.length - 1, current + 1))}
            disabled={mobileRankIndex === journeyStages.length - 1}
            style={({ pressed }) => [
              styles.mobileJourneyArrow,
              mobileRankIndex === journeyStages.length - 1 && styles.mobileJourneyArrowDisabled,
              pressed && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons
              name="chevron-right"
              size={24}
              color={mobileRankIndex === journeyStages.length - 1 ? '#B8C3D9' : '#13254C'}
            />
          </Pressable>
        </View>
      ) : (
        <View style={styles.chestsDesktop}>
          {journeyStages.map((stage, index) => {
            const unlocked = index <= stageIndex;
            const isCurrent = index === stageIndex;
            return (
              <View key={stage.key} style={styles.chestDesktop}>
                <Image
                  source={stage.image}
                  style={[styles.chestImage, isCurrent && styles.chestImageCurrent, !unlocked && styles.chestImageLocked]}
                  resizeMode="contain"
                />
                <Text style={[styles.chestLabel, isCurrent && styles.chestLabelCurrent, !unlocked && styles.chestLabelLocked]}>
                  {stage.label}
                </Text>
                <Text style={[styles.chestLabel, isCurrent && styles.chestLabelCurrent, !unlocked && styles.chestLabelLocked]}>
                  {stage.label}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function ActivitiesCard({ items, isMobile }: { items: RecentActivityItem[]; isMobile: boolean }) {
  return (
    <View style={styles.sideCard}>
      <Ribbon label="RECENT ACTIVITIES" tone="purple" isMobile={isMobile} />
      {items.length === 0 ? (
        <Text style={styles.emptyText}>No attempts yet.</Text>
      ) : (
        <View style={styles.recentList}>
          {items.map((item) => (
            <View key={item.id} style={styles.recentItem}>
              <View style={styles.recentIcon}>
                <MaterialCommunityIcons name="history" size={18} color="#8F4DFF" />
              </View>
              <View style={styles.recentCopy}>
                <Text style={styles.recentTitle} numberOfLines={2}>{item.title}</Text>
                <Text style={styles.recentMeta}>{item.scoreLabel} • {item.timeLabel}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function WeeklyProgressCard({ points, isMobile }: { points: WeeklyPoint[]; isMobile: boolean }) {
  const maxCount = Math.max(1, ...points.map((point) => point.count));

  return (
    <View style={styles.sideCard}>
      <Ribbon label="WEEKLY PROGRESS" tone="blue" isMobile={isMobile} />
      <View style={styles.weeklyWrap}>
        {points.map((point, index) => (
          <View key={`${point.day}-${index}`} style={styles.weekCol}>
            <View style={styles.weekTrack}>
              <View style={[styles.weekBar, { height: Math.max(10, Math.round((point.count / maxCount) * 110)) }]} />
            </View>
            <Text style={styles.weekCount}>{point.count}</Text>
            <Text style={styles.weekDay}>{point.day}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function MobileNav({ active, onChange }: { active: NavKey; onChange: (key: NavKey) => void }) {
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

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const mode: Mode = width >= 1200 ? 'desktop' : width >= 700 ? 'tablet' : 'mobile';

  const [activeNav, setActiveNav] = useState<NavKey>('home');
  const [pausedAttempt, setPausedAttempt] = useState<PausedMockAttempt | null>(null);
  const [userName, setUserName] = useState('User');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [performance, setPerformance] = useState<UserPerformance>(defaultPerformance);
  const [activities, setActivities] = useState<RecentActivityItem[]>([]);
  const [weeklyPoints, setWeeklyPoints] = useState<WeeklyPoint[]>(emptyWeeklyPoints);

  const desktop = mode === 'desktop';
  const isMobile = mode === 'mobile';

  const applySession = useCallback(async (session: Awaited<ReturnType<typeof getCachedSession>>) => {
    const userId = session?.user?.id ?? null;
    if (!userId) {
      setUserName('User');
      setAvatarUrl(null);
      setPerformance(defaultPerformance);
      setActivities([]);
      setWeeklyPoints(emptyWeeklyPoints);
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

    const dashboard = await getCachedUserDashboardData(userId);
    setPerformance({
      testsCompleted: dashboard.testsCompleted,
      accuracyPct: dashboard.accuracyPct,
      averageScore: dashboard.averageScore,
      totalTimeSeconds: dashboard.totalTimeSeconds,
    });
    setActivities(dashboard.activities);
    setWeeklyPoints(dashboard.weeklyPoints);
  }, []);

  const refreshHomeData = useCallback(async () => {
    if (!supabase || !hasSupabaseConfig) {
      setPausedAttempt(null);
      setUserName('User');
      setAvatarUrl(null);
      setPerformance(defaultPerformance);
      setActivities([]);
      setWeeklyPoints(emptyWeeklyPoints);
      return;
    }

    const [session, paused] = await Promise.all([getCachedSession(), getPausedMockAttempt()]);
    setPausedAttempt(paused);
    await applySession(session);
  }, [applySession]);

  useEffect(() => {
    const client = supabase;

    async function loadUser() {
      if (!client || !hasSupabaseConfig) {
        setUserName('User');
        setAvatarUrl(null);
        setPerformance(defaultPerformance);
        setActivities([]);
        setWeeklyPoints(emptyWeeklyPoints);
        return;
      }

      const session = await getCachedSession();
      await applySession(session);
    }

    loadUser();

    if (!client) return;
    const { data } = client.auth.onAuthStateChange(async (_event, session) => {
      cacheSession(session);
      if (!session?.user?.id) {
        clearAppDataCache();
      }
      await applySession(session);
    });
    return () => data.subscription.unsubscribe();
  }, [applySession]);

  useFocusEffect(
    useCallback(() => {
      void refreshHomeData();
      return undefined;
    }, [refreshHomeData])
  );

  const handleNavChange = (key: NavKey) => {
    setActiveNav(key);
    if (key === 'home') return;
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

  const onPressQuickStart = () => {
    router.push('/mock-subjects' as never);
  };

  const onPressContinueLastTest = async () => {
    if (!pausedAttempt?.testId) return;
    const session = await getCachedSession();
    if (!session?.user?.id) {
      router.replace('/auth' as never);
      return;
    }

    router.push({
      pathname: '/mock-test/[testid]',
      params: { testid: pausedAttempt.testId, resume: '1' },
    });
  };

  return (
    <View style={styles.page}>
      <View style={styles.app}>
        {desktop ? (
          <SidebarNav
            active={activeNav}
            onChange={handleNavChange}
            userName={userName}
            avatarUrl={avatarUrl}
          />
        ) : null}

        <View style={styles.main}>
          <ScrollView contentContainerStyle={[styles.mainScroll, !desktop && styles.mainScrollMobile]}>
            <View style={[styles.dashboard, desktop && styles.dashboardDesktop]}>
              <View style={styles.leftCol}>
                <Hero />
                {pausedAttempt ? (
                  <QuickAction onPress={onPressContinueLastTest} title="CONTINUE LAST TEST" subtitle={pausedAttempt.testTitle} isMobile={isMobile} />
                ) : (
                  <QuickAction onPress={onPressQuickStart} title="⚔️ START MOCK TEST" isMobile={isMobile} />
                )}
                <PerformanceCard performance={performance} isMobile={isMobile} />
                <JourneyCard performance={performance} isMobile={isMobile} />
              </View>

              <View style={[styles.rightCol, desktop && styles.rightColDesktop]}>
                <ActivitiesCard items={activities} isMobile={isMobile} />
                <WeeklyProgressCard points={weeklyPoints} isMobile={isMobile} />
                {/* Daily tasks hidden for now. */}
              </View>
            </View>
          </ScrollView>

          {!desktop ? <MobileNav active={activeNav} onChange={handleNavChange} /> : null}
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
  app: {
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
  },
  profileAvatar: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 5,
    borderColor: '#FFD55C',
  },
  profileTextWrap: {
    flex: 1,
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
  mainScroll: {
    padding: 24,
  },
  mainScrollMobile: {
    paddingBottom: 120,
  },
  dashboard: {
    gap: 22,
  },
  dashboardDesktop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  leftCol: {
    flex: 1,
    gap: 22,
    minWidth: 0,
  },
  rightCol: {
    gap: 22,
  },
  rightColDesktop: {
    width: 340,
    flexShrink: 0,
  },
  heroImage: {
    width: '100%',
    borderRadius: 24,
  },
  quick: {
    backgroundColor: '#FF8F12',
    borderRadius: 28,
    paddingVertical: 22,
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#FF8C00',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 3,
  },
  quickCopy: {
    flex: 1,
    paddingRight: 16,
  },
  quickTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  quickSubtitle: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF7ED',
  },
  quickArrow: {
    fontSize: 30,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  panel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 36,
    padding: 24,
    shadowColor: '#3B5998',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 3,
  },
  ribbon: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 14,
    marginBottom: 18,
    shadowColor: '#3B5998',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 2,
  },
  ribbonBlue: {
    backgroundColor: '#4C7DFF',
  },
  ribbonPurple: {
    backgroundColor: '#A76CFF',
  },
  ribbonPink: {
    backgroundColor: '#FF5C97',
  },
  ribbonText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  ribbonMobile: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 9,
  },
  ribbonTextMobile: {
    fontSize: 11,
  },
  performanceGrid: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 20,
    justifyContent: 'space-between',
  },
  perfItem: {
    flex: 1,
    minWidth: 180,
    alignItems: 'center',
  },
  circle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 12,
    borderColor: '#FF8B2B',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF8C00',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 3,
  },
  circleValue: {
    fontSize: 42,
    fontWeight: '900',
    color: '#13254C',
  },
  circleLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#63708C',
  },
  perfEmoji: {
    fontSize: 56,
    marginBottom: 10,
  },
  perfValue: {
    fontSize: 30,
    fontWeight: '900',
    color: '#13254C',
  },
  perfLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#63708C',
    textAlign: 'center',
  },
  chestsDesktop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  chestDesktop: {
    width: '20%',
    alignItems: 'center',
  },
  chestImage: {
    width: 92,
    height: 92,
    marginBottom: 10,
  },
  chestImageCurrent: {
    width: 118,
    height: 118,
    marginBottom: 6,
  },
  chestImageLocked: {
    opacity: 0.4,
  },
  chestLabel: {
    fontSize: 18,
    fontWeight: '800',
    color: '#13254C',
    textAlign: 'center',
  },
  chestLabelCurrent: {
    fontSize: 20,
  },
  chestLabelLocked: {
    color: '#94A3B8',
  },
  mobileJourney: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  mobileJourneyArrow: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F4F7FF',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  mobileJourneyArrowDisabled: {
    backgroundColor: '#EEF2FB',
  },
  mobileJourneyCard: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 24,
    backgroundColor: '#F8FBFF',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  mobileJourneyImageWrap: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileJourneyImage: {
    width: '72%',
    height: '72%',
  },
  mobileJourneyImageCurrent: {
    width: '84%',
    height: '84%',
  },
  mobileJourneyLabel: {
    marginTop: 8,
    fontSize: 22,
    fontWeight: '900',
    color: '#13254C',
    textAlign: 'center',
  },
  mobileJourneyLabelCurrent: {
    fontSize: 24,
  },
  sideCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    padding: 20,
    minHeight: 190,
    shadowColor: '#3B5998',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 3,
  },
  emptyText: {
    marginTop: 18,
    fontSize: 16,
    fontWeight: '600',
    color: '#63708C',
  },
  recentList: {
    gap: 12,
    marginTop: 6,
  },
  recentItem: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingVertical: 8,
  },
  recentIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#F2EAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentCopy: {
    flex: 1,
  },
  recentTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#13254C',
    lineHeight: 20,
  },
  recentMeta: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
    color: '#63708C',
  },
  weeklyWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 170,
    paddingTop: 8,
  },
  weekCol: {
    flex: 1,
    alignItems: 'center',
  },
  weekTrack: {
    width: 28,
    height: 120,
    justifyContent: 'flex-end',
    backgroundColor: '#EEF2FB',
    borderRadius: 999,
    overflow: 'hidden',
  },
  weekBar: {
    width: '100%',
    backgroundColor: '#48C774',
    borderRadius: 999,
  },
  weekCount: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '800',
    color: '#13254C',
  },
  weekDay: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#63708C',
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
  quickMobile: {
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 22,
  },
  quickMobileCompact: {
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderRadius: 18,
  },
  quickTitleMobile: {
    fontSize: 18,
  },
  quickTitleMobileCompact: {
    fontSize: 13,
  },
  quickSubtitleMobile: {
    fontSize: 12,
  },
  quickSubtitleMobileCompact: {
    fontSize: 8,
    marginTop: 4,
  },
  quickArrowMobile: {
    fontSize: 22,
  },
  quickArrowMobileCompact: {
    fontSize: 15,
  },
  performanceGridMobile: {
    gap: 8,
  },
  perfItemMobile: {
    minWidth: 0,
    flex: 1,
  },
  circleMobile: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 8,
  },
  circleValueMobile: {
    fontSize: 18,
  },
  circleLabelMobile: {
    fontSize: 10,
  },
  perfEmojiMobile: {
    fontSize: 28,
    marginBottom: 6,
  },
  perfValueMobile: {
    fontSize: 16,
  },
  perfLabelMobile: {
    fontSize: 10,
    lineHeight: 12,
  },
});

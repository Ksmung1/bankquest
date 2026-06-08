import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppChrome } from '@/components/app-chrome';
import { cacheSession, getCachedMockExamList, getCachedSession, peekCachedMockExamList, type LiveMockExamSummary } from '@/lib/app-data-cache';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';

const examImages = {
  ibps: require('@/assets/images/ibps.png'),
  sbi: require('@/assets/images/sbi.png'),
  rbi: require('@/assets/images/rbi.jpg'),
  nabard: require('@/assets/images/nabard.jpeg'),
  ssc: require('@/assets/images/ssc.png'),
} as const;

const testHeroSource = require('@/assets/images/test-hero.png');
const TEST_HERO_ASPECT_RATIO = 16 / 9;

function getExamImageSource(exam: string) {
  const normalizedExam = exam.trim().toLowerCase();
  if (normalizedExam.includes('ibps')) return examImages.ibps;
  if (normalizedExam.includes('sbi')) return examImages.sbi;
  if (normalizedExam.includes('rbi')) return examImages.rbi;
  if (normalizedExam.includes('nabard')) return examImages.nabard;
  if (normalizedExam.includes('ssc')) return examImages.ssc;
  return null;
}

export default function MockSubjectsPage() {
  const router = useRouter();
  const [tests, setTests] = useState<LiveMockExamSummary[]>(() => peekCachedMockExamList() ?? []);
  const [loading, setLoading] = useState(() => peekCachedMockExamList() === null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadTests() {
      try {
        if (!supabase || !hasSupabaseConfig) {
          if (!mounted) return;
          setTests([]);
          setLoadError(null);
          setLoading(false);
          return;
        }

        setLoadError(null);
        const mapped = await getCachedMockExamList();
        if (!mounted) return;
        setTests(mapped ?? []);
      } catch (error) {
        console.error('Failed to load mock subjects', error);
        if (!mounted) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to load exams.');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadTests();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function resolveSession() {
      try {
        const session = await getCachedSession();
        if (!mounted) return;
        setSessionUserId(session?.user?.id ?? null);
      } catch (error) {
        console.error('Failed to resolve mock subjects session', error);
        if (!mounted) return;
        setSessionUserId(null);
      }
    }

    void resolveSession();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!supabase) {
      setSessionUserId(null);
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      cacheSession(session);
      setSessionUserId(session?.user?.id ?? null);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  const exams = useMemo(() => Array.from(new Set(tests.map((test) => test.exam))), [tests]);

  return (
    <AppChrome active="tests">
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.empty}>Loading exams...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          <Image source={testHeroSource} style={styles.heroImage} resizeMode="contain" />

          {!sessionUserId ? <Text style={styles.guestNote}>Browsing as guest. Sign in only when you want to save progress.</Text> : null}
          {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

          {!loading && exams.length === 0 ? <Text style={styles.empty}>No live exams found yet.</Text> : null}

          <View style={styles.grid}>
            {exams.map((exam) => (
              <Pressable
                key={exam}
                onPress={() => router.push({ pathname: '/mock-test', params: { exam } })}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.cardHeading}>
                    <View style={styles.iconWrap}>
                      {getExamImageSource(exam) ? (
                        <Image source={getExamImageSource(exam)!} style={styles.examImage} resizeMode="cover" />
                      ) : (
                        <MaterialCommunityIcons name="clipboard-text-outline" size={22} color="#2563EB" />
                      )}
                    </View>
                    <View style={styles.cardCopy}>
                      <Text style={styles.cardTitle}>{exam}</Text>
                      <Text style={styles.cardText}>Open this exam to browse every mock test inside it.</Text>
                    </View>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={18} color="#94A3B8" />
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, backgroundColor: '#EAF3FF', padding: 16 },
  container: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 28, gap: 16 },
  heroImage: {
    width: '100%',
    aspectRatio: TEST_HERO_ASPECT_RATIO,
    alignSelf: 'stretch',
  },
  guestNote: { fontSize: 13, color: '#2563EB', fontWeight: '700' },
  errorText: { fontSize: 13, color: '#DC2626', fontWeight: '700' },
  empty: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  grid: { gap: 12 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cardHeading: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    overflow: 'hidden',
    flexShrink: 0,
  },
  examImage: {
    width: '100%',
    height: '100%',
  },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 20, fontWeight: '900', color: '#0F172A' },
  cardText: { marginTop: 4, fontSize: 13, lineHeight: 20, fontWeight: '600', color: '#64748B' },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
});

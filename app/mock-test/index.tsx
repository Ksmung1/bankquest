import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getCachedMockTestsByExam, getCachedSession, peekCachedMockTestsByExam } from '@/lib/app-data-cache';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { countSectionQuestions, flattenSectionQuestions, type LiveMockListItem } from '@/constants/mock-live-types';
import { AppChrome } from '@/components/app-chrome';

const examImages = {
  ibps: require('@/assets/images/ibps.png'),
  sbi: require('@/assets/images/sbi.png'),
  rbi: require('@/assets/images/rbi.jpg'),
  nabard: require('@/assets/images/nabard.jpeg'),
  ssc: require('@/assets/images/ssc.png'),
} as const;

const testHeroSource = require('@/assets/images/mockid-hero.png');

const accentThemes = [
  {
    badge: ['#4F86FF', '#3A63FF'],
    button: '#3B67FF',
    pillBg: '#EFF9FF',
    pillText: '#3566FF',
  },
  {
    badge: ['#B36DFF', '#8F52FF'],
    button: '#8F52FF',
    pillBg: '#F7EEFF',
    pillText: '#9858FF',
  },
  {
    badge: ['#61D86E', '#34B84F'],
    button: '#35B84E',
    pillBg: '#EFFFEF',
    pillText: '#35AF4D',
  },
  {
    badge: ['#FFB14B', '#FF8623'],
    button: '#FF8820',
    pillBg: '#FFF5E8',
    pillText: '#FF9B1C',
  },
  {
    badge: ['#3DC8FF', '#15A9DF'],
    button: '#17ABD9',
    pillBg: '#EEF9FF',
    pillText: '#1B9BCC',
  },
] as const;

const recommendationLabels = ['Recommended', 'Your Next Step', 'Practice More', 'Keep Going', 'Final Challenge'] as const;

const scaleValue = (value: number, factor: number) => Math.round(value * factor);

function getExamImageSource(exam: string) {
  const normalizedExam = exam.trim().toLowerCase();
  if (normalizedExam.includes('ibps')) return examImages.ibps;
  if (normalizedExam.includes('sbi')) return examImages.sbi;
  if (normalizedExam.includes('rbi')) return examImages.rbi;
  if (normalizedExam.includes('nabard')) return examImages.nabard;
  if (normalizedExam.includes('ssc')) return examImages.ssc;
  return null;
}

function getExamSubtitle(exam: string) {
  const normalizedExam = exam.trim().toLowerCase();
  if (normalizedExam.includes('ibps')) return 'Institute of Banking Personnel Selection';
  if (normalizedExam.includes('sbi')) return 'State Bank of India';
  if (normalizedExam.includes('rbi')) return 'Reserve Bank of India';
  if (normalizedExam.includes('nabard')) return 'National Bank for Agriculture and Rural Development';
  if (normalizedExam.includes('ssc')) return 'Staff Selection Commission';
  return 'Live mock test series';
}

function getTestMetrics(test: LiveMockListItem) {
  const totalQuestions = test.payload.sections.reduce((sum, section) => sum + countSectionQuestions(section), 0);
  const totalMinutes = Math.round((test.payload.totalTimeSeconds ?? 0) / 60);
  const sectionCount = test.payload.sections.length;

  const difficulties = test.payload.sections.flatMap((section) =>
    flattenSectionQuestions(section).map((question) => String(question.difficulty ?? '').trim().toLowerCase()).filter(Boolean)
  );

  const difficultyScore =
    difficulties.length === 0
      ? 2
      : difficulties.reduce((sum, item) => {
          if (item.includes('easy')) return sum + 1;
          if (item.includes('hard')) return sum + 3;
          return sum + 2;
        }, 0) / difficulties.length;

  const difficulty = difficultyScore < 1.75 ? 'Easy' : difficultyScore > 2.35 ? 'Hard' : 'Moderate';

  return {
    totalQuestions,
    totalMinutes,
    sectionCount,
    difficulty,
  };
}

function getOverviewMetrics(tests: LiveMockListItem[]) {
  if (tests.length === 0) {
    return {
      totalQuestions: 0,
      totalMinutes: 0,
      sectionCount: 0,
      difficulty: 'Moderate',
    };
  }

  const metrics = tests.map(getTestMetrics);
  const first = metrics[0];
  const sameQuestions = metrics.every((item) => item.totalQuestions === first.totalQuestions);
  const sameMinutes = metrics.every((item) => item.totalMinutes === first.totalMinutes);
  const sameSections = metrics.every((item) => item.sectionCount === first.sectionCount);
  const difficultyCounts = metrics.reduce<Record<string, number>>((acc, item) => {
    acc[item.difficulty] = (acc[item.difficulty] ?? 0) + 1;
    return acc;
  }, {});
  const difficulty =
    Object.entries(difficultyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    first.difficulty;

  return {
    totalQuestions: sameQuestions ? first.totalQuestions : Math.max(...metrics.map((item) => item.totalQuestions)),
    totalMinutes: sameMinutes ? first.totalMinutes : Math.max(...metrics.map((item) => item.totalMinutes)),
    sectionCount: sameSections ? first.sectionCount : Math.max(...metrics.map((item) => item.sectionCount)),
    difficulty,
  };
}

export default function MockTestsPage() {
  const router = useRouter();
  const params = useLocalSearchParams<{ exam?: string | string[] }>();
  const examParam = Array.isArray(params.exam) ? params.exam[0] : params.exam;
  const selectedExam = typeof examParam === 'string' ? decodeURIComponent(examParam).trim() : '';
  const [tests, setTests] = useState<LiveMockListItem[]>(() => (selectedExam ? peekCachedMockTestsByExam(selectedExam) ?? [] : []));
  const [attemptCounts, setAttemptCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(() => (selectedExam ? peekCachedMockTestsByExam(selectedExam) === null : false));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTest, setSelectedTest] = useState<LiveMockListItem | null>(null);
  const { width } = useWindowDimensions();
  const isCompact = width < 760;
  const pageScale = isCompact ? 0.6 : 0.8;

  useEffect(() => {
    if (!selectedExam) {
      router.replace('/mock-subjects' as never);
      return;
    }

    let mounted = true;

    async function init() {
      try {
        setLoadError(null);
        const mapped = supabase && hasSupabaseConfig ? await getCachedMockTestsByExam(selectedExam) : [];
        if (!mounted) return;
        setTests(mapped ?? []);

        if (!supabase || !hasSupabaseConfig || !mapped.length) {
          setAttemptCounts({});
          return;
        }

        const session = await getCachedSession();
        const userId = session?.user?.id ?? null;

        if (!mounted) return;

        if (!userId) {
          setAttemptCounts({});
          return;
        }

        const { data: attempts, error: attemptsError } = await supabase
          .from('mock_test_attempts')
          .select('test_id')
          .eq('user_id', userId)
          .in('test_id', mapped.map((test) => test.id));

        if (!mounted) return;

        if (attemptsError) {
          throw attemptsError;
        }

        const nextAttemptCounts = (attempts ?? []).reduce<Record<string, number>>((acc, row) => {
          const testId = String(row.test_id ?? '');
          if (!testId) return acc;
          acc[testId] = (acc[testId] ?? 0) + 1;
          return acc;
        }, {});

        setAttemptCounts(nextAttemptCounts);
      } catch (error) {
        console.error('Failed to load exam mock tests', error);
        if (!mounted) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to load mock tests.');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, [router, selectedExam]);

  const filteredTests = useMemo(() => {
    const examKey = selectedExam.trim().toLowerCase();
    return tests.filter((test) => test.exam.trim().toLowerCase() === examKey);
  }, [selectedExam, tests]);

  const overview = useMemo(() => getOverviewMetrics(filteredTests), [filteredTests]);
  const examLogo = getExamImageSource(selectedExam);

  const handleOpenTestPress = async (test: LiveMockListItem) => {
    setSelectedTest(test);
  };

  const openSelectedTest = () => {
    if (!selectedTest) return;
    const id = selectedTest.id;
    setSelectedTest(null);
    router.push({ pathname: '/mock-test/[testid]', params: { testid: id } });
  };

  return (
    <AppChrome active="tests">
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable onPress={() => router.push('/mock-subjects' as never)} style={({ pressed }) => [styles.backRow, pressed && styles.pressedLite]}>
          <MaterialCommunityIcons name="arrow-left" size={18} color="#3B68FF" />
          <Text style={[styles.backText, { fontSize: scaleValue(15, pageScale) }]}>Back to Choose Exam</Text>
        </Pressable>

        <View style={[styles.hero, isCompact && styles.heroCompact, { borderRadius: scaleValue(34, pageScale), paddingVertical: scaleValue(isCompact ? 22 : 26, pageScale), paddingHorizontal: scaleValue(isCompact ? 20 : 24, pageScale), gap: scaleValue(20, pageScale) }]}>
          <View style={[styles.heroLeft, isCompact && styles.heroLeftCompact, { gap: scaleValue(18, pageScale) }]}>
            <View style={[styles.heroLogoWrap, { width: scaleValue(90, pageScale), height: scaleValue(90, pageScale), borderRadius: scaleValue(28, pageScale), padding: scaleValue(14, pageScale) }]}>
              {examLogo ? (
                <Image source={examLogo} style={styles.heroLogo} resizeMode="contain" />
              ) : (
                <MaterialCommunityIcons name="file-document-outline" size={38} color="#3B68FF" />
              )}
            </View>

            <View style={styles.heroCopy}>
              <Text style={[styles.heroTitle, { fontSize: scaleValue(42, pageScale), lineHeight: scaleValue(46, pageScale) }]}>{selectedExam}</Text>
              <Text style={[styles.heroSubtitle, { marginTop: scaleValue(8, pageScale), fontSize: scaleValue(16, pageScale), lineHeight: scaleValue(23, pageScale) }]}>{getExamSubtitle(selectedExam)}</Text>

              <View style={[styles.testCountChip, { marginTop: scaleValue(18, pageScale), gap: scaleValue(10, pageScale), paddingHorizontal: scaleValue(18, pageScale), paddingVertical: scaleValue(12, pageScale), borderRadius: scaleValue(16, pageScale) }]}>
                <MaterialCommunityIcons name="clipboard-text-outline" size={18} color="#3566FF" />
                <Text style={[styles.testCountText, { fontSize: scaleValue(15, pageScale) }]}>Total {filteredTests.length} Mock Tests</Text>
              </View>
            </View>
          </View>

          <View style={[styles.heroRight, isCompact && styles.heroRightCompact]}>
            <Image source={testHeroSource} style={[styles.heroImage, { height: scaleValue(isCompact ? 320 : 340, pageScale) }]} resizeMode="contain" />
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color="#3566FF" />
            <Text style={styles.empty}>Loading mock tests...</Text>
          </View>
        ) : null}

        {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

        {!loading && filteredTests.length > 0 ? (
          <View style={[styles.statsGrid, { marginTop: scaleValue(24, pageScale), gap: scaleValue(16, pageScale) }]}>
            <View style={[styles.statCard, isCompact && styles.statCardMobile, { borderRadius: scaleValue(28, pageScale), paddingVertical: scaleValue(24, pageScale), paddingHorizontal: scaleValue(20, pageScale), minHeight: scaleValue(150, pageScale) }]}>
              <View style={[styles.statIcon, styles.statBlue, { width: scaleValue(56, pageScale), height: scaleValue(56, pageScale), borderRadius: scaleValue(18, pageScale), marginBottom: scaleValue(10, pageScale) }]}>
                <MaterialCommunityIcons name="file-document-outline" size={24} color="#3C68FF" />
              </View>
              <Text style={[styles.statValue, { fontSize: scaleValue(32, pageScale), lineHeight: scaleValue(36, pageScale) }]}>{overview.totalQuestions}</Text>
              <Text style={[styles.statLabel, { marginTop: scaleValue(6, pageScale), fontSize: scaleValue(15, pageScale) }]}>Questions</Text>
            </View>

            <View style={[styles.statCard, isCompact && styles.statCardMobile, { borderRadius: scaleValue(28, pageScale), paddingVertical: scaleValue(24, pageScale), paddingHorizontal: scaleValue(20, pageScale), minHeight: scaleValue(150, pageScale) }]}>
              <View style={[styles.statIcon, styles.statGreen, { width: scaleValue(56, pageScale), height: scaleValue(56, pageScale), borderRadius: scaleValue(18, pageScale), marginBottom: scaleValue(10, pageScale) }]}>
                <MaterialCommunityIcons name="clock-outline" size={24} color="#34B54A" />
              </View>
              <Text style={[styles.statValue, { fontSize: scaleValue(32, pageScale), lineHeight: scaleValue(36, pageScale) }]}>{overview.totalMinutes}</Text>
              <Text style={[styles.statLabel, { marginTop: scaleValue(6, pageScale), fontSize: scaleValue(15, pageScale) }]}>Minutes</Text>
            </View>

            <View style={[styles.statCard, isCompact && styles.statCardMobile, { borderRadius: scaleValue(28, pageScale), paddingVertical: scaleValue(24, pageScale), paddingHorizontal: scaleValue(20, pageScale), minHeight: scaleValue(150, pageScale) }]}>
              <View style={[styles.statIcon, styles.statPurple, { width: scaleValue(56, pageScale), height: scaleValue(56, pageScale), borderRadius: scaleValue(18, pageScale), marginBottom: scaleValue(10, pageScale) }]}>
                <MaterialCommunityIcons name="view-grid-outline" size={24} color="#9858FF" />
              </View>
              <Text style={[styles.statValue, { fontSize: scaleValue(32, pageScale), lineHeight: scaleValue(36, pageScale) }]}>{overview.sectionCount}</Text>
              <Text style={[styles.statLabel, { marginTop: scaleValue(6, pageScale), fontSize: scaleValue(15, pageScale) }]}>Sections</Text>
            </View>

            <View style={[styles.statCard, isCompact && styles.statCardMobile, { borderRadius: scaleValue(28, pageScale), paddingVertical: scaleValue(24, pageScale), paddingHorizontal: scaleValue(20, pageScale), minHeight: scaleValue(150, pageScale) }]}>
              <View style={[styles.statIcon, styles.statOrange, { width: scaleValue(56, pageScale), height: scaleValue(56, pageScale), borderRadius: scaleValue(18, pageScale), marginBottom: scaleValue(10, pageScale) }]}>
                <MaterialCommunityIcons name="signal-cellular-2" size={24} color="#FF9A22" />
              </View>
              <Text style={[styles.statValue, { fontSize: scaleValue(32, pageScale), lineHeight: scaleValue(36, pageScale) }]}>{overview.difficulty}</Text>
              <Text style={[styles.statLabel, { marginTop: scaleValue(6, pageScale), fontSize: scaleValue(15, pageScale) }]}>Difficulty</Text>
            </View>
          </View>
        ) : null}

        {!loading && !loadError && filteredTests.length === 0 ? <Text style={styles.empty}>No live mock tests found for this exam.</Text> : null}

        <View style={[styles.mockList, { marginTop: scaleValue(28, pageScale), gap: scaleValue(22, pageScale) }]}>
          {filteredTests.map((test, index) => {
            const metrics = getTestMetrics(test);
            const theme = accentThemes[index % accentThemes.length];
            const pillLabel = recommendationLabels[index] ?? recommendationLabels[recommendationLabels.length - 1];
            const attemptCount = attemptCounts[test.id] ?? 0;

            return (
              <View key={test.id} style={[styles.mockCard, { borderRadius: scaleValue(32, pageScale), padding: scaleValue(26, pageScale) }]}>
                <View style={[styles.mockMainRow, isCompact && styles.mockMainRowCompact, { gap: scaleValue(20, pageScale) }]}>
                  <View style={[styles.mockLeft, { gap: scaleValue(22, pageScale) }]}>
                    <View style={[styles.rankBadge, { backgroundColor: theme.badge[0], width: scaleValue(74, pageScale), height: scaleValue(74, pageScale), borderRadius: scaleValue(24, pageScale) }]}>
                      <Text style={[styles.rankBadgeText, { fontSize: scaleValue(30, pageScale) }]}>{index + 1}</Text>
                    </View>

                    <View style={styles.mockInfo}>
                      <Text style={[styles.mockTitle, { fontSize: scaleValue(32, pageScale), lineHeight: scaleValue(36, pageScale) }]}>{test.title}</Text>

                      <View style={[styles.metaRow, { marginTop: scaleValue(10, pageScale), gap: scaleValue(16, pageScale) }]}>
                        <View style={[styles.metaItem, { gap: scaleValue(6, pageScale) }]}>
                          <MaterialCommunityIcons name="file-document-outline" size={16} color="#64729B" />
                          <Text style={[styles.metaText, { fontSize: scaleValue(15, pageScale) }]}>{metrics.totalQuestions} Questions</Text>
                        </View>
                        <View style={[styles.metaItem, { gap: scaleValue(6, pageScale) }]}>
                          <MaterialCommunityIcons name="clock-outline" size={16} color="#64729B" />
                          <Text style={[styles.metaText, { fontSize: scaleValue(15, pageScale) }]}>{metrics.totalMinutes} Minutes</Text>
                        </View>
                        <View style={[styles.metaItem, { gap: scaleValue(6, pageScale) }]}>
                          <MaterialCommunityIcons name="view-grid-outline" size={16} color="#64729B" />
                          <Text style={[styles.metaText, { fontSize: scaleValue(15, pageScale) }]}>{metrics.sectionCount} Sections</Text>
                        </View>
                        <View style={[styles.metaItem, { gap: scaleValue(6, pageScale) }]}>
                          <MaterialCommunityIcons name="signal-cellular-2" size={16} color="#64729B" />
                          <Text style={[styles.metaText, { fontSize: scaleValue(15, pageScale) }]}>{metrics.difficulty}</Text>
                        </View>
                      </View>

                      <View style={[styles.infoPillsRow, { marginTop: scaleValue(14, pageScale), gap: scaleValue(10, pageScale) }]}>
                        <View style={[styles.recommendationPill, { backgroundColor: theme.pillBg, paddingHorizontal: scaleValue(16, pageScale), paddingVertical: scaleValue(10, pageScale) }]}>
                          <Text style={[styles.recommendationText, { color: theme.pillText, fontSize: scaleValue(14, pageScale) }]}>{pillLabel}</Text>
                        </View>

                        {attemptCount > 0 ? (
                          <View style={[styles.attemptPill, { paddingHorizontal: scaleValue(16, pageScale), paddingVertical: scaleValue(10, pageScale) }]}>
                            <MaterialCommunityIcons name="history" size={scaleValue(14, pageScale)} color="#0F766E" />
                            <Text style={[styles.attemptPillText, { fontSize: scaleValue(14, pageScale) }]}>Attempts: {attemptCount}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </View>

                  <View style={[styles.mockActions, isCompact && styles.mockActionsCompact, { gap: scaleValue(16, pageScale) }]}>
                    <Pressable onPress={() => handleOpenTestPress(test)} style={({ pressed }) => [styles.startButton, { backgroundColor: theme.button, minWidth: scaleValue(188, pageScale), borderRadius: scaleValue(18, pageScale), paddingHorizontal: scaleValue(24, pageScale), paddingVertical: scaleValue(18, pageScale), gap: scaleValue(10, pageScale) }, pressed && styles.pressedLite]}>
                      <Text style={[styles.startButtonText, { fontSize: scaleValue(18, pageScale) }]}>Start Test</Text>
                      <MaterialCommunityIcons name="arrow-right" size={18} color="#FFFFFF" />
                    </Pressable>

                    <Pressable onPress={() => handleOpenTestPress(test)} style={({ pressed }) => [styles.expandButton, { width: scaleValue(46, pageScale), height: scaleValue(46, pageScale), borderRadius: scaleValue(14, pageScale) }, pressed && styles.pressedLite]}>
                      <MaterialCommunityIcons name="chevron-down" size={22} color="#64729B" />
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <Modal transparent visible={Boolean(selectedTest)} animationType="fade" onRequestClose={() => setSelectedTest(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.confirmCard, { borderRadius: scaleValue(30, pageScale), padding: scaleValue(28, pageScale) }]}>
            <View style={styles.confirmOrb} />

            <View style={styles.confirmHeader}>
              <View style={[styles.confirmIconWrap, { width: scaleValue(72, pageScale), height: scaleValue(72, pageScale), borderRadius: scaleValue(22, pageScale) }]}>
                <MaterialCommunityIcons name="rocket-launch-outline" size={scaleValue(34, pageScale)} color="#3B67FF" />
              </View>
              <Pressable onPress={() => setSelectedTest(null)} hitSlop={8} style={[styles.confirmCloseBtn, { width: scaleValue(42, pageScale), height: scaleValue(42, pageScale), borderRadius: scaleValue(14, pageScale) }]}>
                <MaterialCommunityIcons name="close" size={scaleValue(20, pageScale)} color="#64748B" />
              </Pressable>
            </View>

            <Text style={[styles.confirmEyebrow, { marginTop: scaleValue(18, pageScale), fontSize: scaleValue(13, pageScale) }]}>Ready To Begin</Text>
            <Text style={[styles.confirmTitle, { marginTop: scaleValue(8, pageScale), fontSize: scaleValue(32, pageScale), lineHeight: scaleValue(34, pageScale) }]}>Start Test</Text>
            <Text style={[styles.confirmText, { marginTop: scaleValue(10, pageScale), fontSize: scaleValue(16, pageScale), lineHeight: scaleValue(24, pageScale) }]}>
              {`You are about to begin "${selectedTest?.title ?? 'this test'}". Once started, the timer begins immediately.`}
            </Text>

            <View style={[styles.confirmPreviewCard, { marginTop: scaleValue(18, pageScale), borderRadius: scaleValue(22, pageScale), padding: scaleValue(18, pageScale) }]}>
              <Text style={[styles.confirmPreviewLabel, { fontSize: scaleValue(12, pageScale) }]}>Selected Mock</Text>
              <Text style={[styles.confirmPreviewTitle, { marginTop: scaleValue(6, pageScale), fontSize: scaleValue(20, pageScale), lineHeight: scaleValue(24, pageScale) }]}>
                {selectedTest?.title ?? 'Mock Test'}
              </Text>
              <View style={[styles.confirmPreviewMetaRow, { marginTop: scaleValue(12, pageScale), gap: scaleValue(10, pageScale) }]}>
                <View style={[styles.confirmPreviewChip, { borderRadius: scaleValue(999, pageScale), paddingHorizontal: scaleValue(12, pageScale), paddingVertical: scaleValue(8, pageScale) }]}>
                  <MaterialCommunityIcons name="file-document-outline" size={scaleValue(15, pageScale)} color="#64729B" />
                  <Text style={[styles.confirmPreviewChipText, { fontSize: scaleValue(13, pageScale) }]}>
                    {selectedTest ? getTestMetrics(selectedTest).totalQuestions : 0} Q
                  </Text>
                </View>
                <View style={[styles.confirmPreviewChip, { borderRadius: scaleValue(999, pageScale), paddingHorizontal: scaleValue(12, pageScale), paddingVertical: scaleValue(8, pageScale) }]}>
                  <MaterialCommunityIcons name="clock-outline" size={scaleValue(15, pageScale)} color="#64729B" />
                  <Text style={[styles.confirmPreviewChipText, { fontSize: scaleValue(13, pageScale) }]}>
                    {selectedTest ? getTestMetrics(selectedTest).totalMinutes : 0} min
                  </Text>
                </View>
                <View style={[styles.confirmPreviewChip, { borderRadius: scaleValue(999, pageScale), paddingHorizontal: scaleValue(12, pageScale), paddingVertical: scaleValue(8, pageScale) }]}>
                  <MaterialCommunityIcons name="view-grid-outline" size={scaleValue(15, pageScale)} color="#64729B" />
                  <Text style={[styles.confirmPreviewChipText, { fontSize: scaleValue(13, pageScale) }]}>
                    {selectedTest ? getTestMetrics(selectedTest).sectionCount : 0} sections
                  </Text>
                </View>
              </View>
            </View>

            <View style={[styles.confirmActions, { marginTop: scaleValue(22, pageScale), gap: scaleValue(12, pageScale) }]}>
              <Pressable
                onPress={() => setSelectedTest(null)}
                style={[styles.confirmBtn, styles.confirmSecondary, { borderRadius: scaleValue(18, pageScale), paddingVertical: scaleValue(16, pageScale) }]}
              >
                <Text style={[styles.confirmSecondaryText, { fontSize: scaleValue(15, pageScale) }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={openSelectedTest}
                style={[styles.confirmBtn, styles.confirmPrimary, { borderRadius: scaleValue(18, pageScale), paddingVertical: scaleValue(16, pageScale) }]}
              >
                <MaterialCommunityIcons name="arrow-right" size={scaleValue(18, pageScale)} color="#FFFFFF" />
                <Text style={[styles.confirmPrimaryText, { fontSize: scaleValue(15, pageScale) }]}>Start Now</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 36,
  },
  backRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
  },
  backText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#3B68FF',
  },
  hero: {
    backgroundColor: '#F4F8FF',
    borderRadius: 34,
    paddingVertical: 26,
    paddingHorizontal: 24,
    borderWidth: 2,
    borderColor: '#EAF0FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 12,
    shadowColor: '#355FBF',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
  },
  heroCompact: {
    paddingHorizontal: 20,
    paddingVertical: 22,
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  heroLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 18,
    width: '50%',
  },
  heroLeftCompact: {
    width: '100%',
    flexDirection: 'column',
  },
  heroLogoWrap: {
    width: 90,
    height: 90,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  heroLogo: {
    width: '100%',
    height: '100%',
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
  },
  heroTitle: {
    fontSize: 42,
    lineHeight: 46,
    fontWeight: '900',
    color: '#18244D',
  },
  heroSubtitle: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
    color: '#5F6C95',
  },
  testCountChip: {
    marginTop: 18,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#EAF1FF',
  },
  testCountText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#3566FF',
  },
  heroRight: {
    width: '50%',
    alignItems: 'flex-start',
    flexShrink: 0,
  },
  heroRightCompact: {
    width: '100%',
    marginLeft: 0,
  },
  heroImage: {
    width: '100%',
    height: 250,
  },
  loadingWrap: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statsGrid: {
    marginTop: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  statCardMobile: {
    flexBasis: '47%',
    maxWidth: '47%',
  },
  statCard: {
    flexGrow: 1,
    flexBasis: 220,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 150,
    shadowColor: '#355FBF',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
  },
  statIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statBlue: { backgroundColor: '#EAF1FF' },
  statGreen: { backgroundColor: '#EBFFF0' },
  statPurple: { backgroundColor: '#F1E8FF' },
  statOrange: { backgroundColor: '#FFF3E3' },
  statValue: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '900',
    color: '#18244D',
    textAlign: 'center',
  },
  statLabel: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: '700',
    color: '#67759E',
    textAlign: 'center',
  },
  empty: {
    marginTop: 18,
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  errorText: {
    marginTop: 18,
    fontSize: 14,
    fontWeight: '700',
    color: '#DC2626',
  },
  mockList: {
    marginTop: 28,
    gap: 22,
  },
  mockCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    padding: 26,
    shadowColor: '#355FBF',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
  },
  mockMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
  },
  mockMainRowCompact: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  mockLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
  },
  rankBadge: {
    width: 74,
    height: 74,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 3,
  },
  rankBadgeText: {
    fontSize: 30,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  mockInfo: {
    flex: 1,
    minWidth: 0,
  },
  mockTitle: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '900',
    color: '#18244D',
  },
  metaRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64729B',
  },
  infoPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  recommendationPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  recommendationText: {
    fontSize: 14,
    fontWeight: '800',
  },
  attemptPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  attemptPillText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F766E',
  },
  mockActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  mockActionsCompact: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  startButton: {
    minWidth: 188,
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  expandButton: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#F5F7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressedLite: {
    opacity: 0.88,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.38)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#EAF0FF',
    overflow: 'hidden',
    shadowColor: '#355FBF',
    shadowOpacity: 0.16,
    shadowRadius: 36,
    elevation: 10,
  },
  confirmOrb: {
    position: 'absolute',
    top: -70,
    right: -40,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#EEF4FF',
  },
  confirmHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  confirmIconWrap: {
    backgroundColor: '#EEF4FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCloseBtn: {
    backgroundColor: '#F6F8FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmEyebrow: {
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: '#3B67FF',
  },
  confirmTitle: {
    fontWeight: '900',
    color: '#18244D',
  },
  confirmText: {
    fontWeight: '600',
    color: '#5F6C95',
  },
  confirmPreviewCard: {
    backgroundColor: '#F8FBFF',
    borderWidth: 1,
    borderColor: '#E6EEFF',
  },
  confirmPreviewLabel: {
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.35,
    color: '#7A86A9',
  },
  confirmPreviewTitle: {
    fontWeight: '900',
    color: '#18244D',
  },
  confirmPreviewMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  confirmPreviewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7EEFF',
  },
  confirmPreviewChipText: {
    fontWeight: '800',
    color: '#64729B',
  },
  confirmActions: {
    flexDirection: 'row',
  },
  confirmBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  confirmSecondary: {
    backgroundColor: '#F6F8FF',
    borderWidth: 1,
    borderColor: '#DFE7FB',
  },
  confirmPrimary: {
    backgroundColor: '#3B67FF',
  },
  confirmSecondaryText: {
    fontWeight: '800',
    color: '#51607F',
  },
  confirmPrimaryText: {
    fontWeight: '800',
    color: '#FFFFFF',
  },
});

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import {
  cacheSession,
  getCachedHistoryRows,
  getCachedMockTests,
  getCachedSession,
  peekCachedHistoryRows,
  peekCachedMockTests,
} from '@/lib/app-data-cache';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { AppChrome } from '@/components/app-chrome';

type HistoryRow = {
  id: string;
  testId: string;
  title: string;
  exam: string;
  score: number;
  totalQuestions: number;
  attempted: number;
  submittedAt: string | null;
};

type EnrichedHistoryRow = HistoryRow & {
  totalMinutes: number;
  sections: number;
  accuracy: number;
  status: 'Completed' | 'Incomplete';
};

const examImages = {
  ibps: require('@/assets/images/ibps.png'),
  sbi: require('@/assets/images/sbi.png'),
  rbi: require('@/assets/images/rbi.jpg'),
  nabard: require('@/assets/images/nabard.jpeg'),
  ssc: require('@/assets/images/ssc.png'),
} as const;

const heroIllustration = require('@/assets/images/history-hero.png');
const footerIllustration = require('@/assets/images/mascot.png');

const scoreCircleColors = ['#3D67FF', '#9A58FF', '#FF5575', '#33C15A'] as const;
const scaleValue = (value: number, factor: number) => Math.round(value * factor);

function formatDate(value: string | null) {
  if (!value) return 'Recently';
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getExamImageSource(exam: string) {
  const normalizedExam = exam.trim().toLowerCase();
  if (normalizedExam.includes('ibps')) return examImages.ibps;
  if (normalizedExam.includes('sbi')) return examImages.sbi;
  if (normalizedExam.includes('rbi')) return examImages.rbi;
  if (normalizedExam.includes('nabard')) return examImages.nabard;
  if (normalizedExam.includes('ssc')) return examImages.ssc;
  return null;
}

function getCurrentStreak(rows: HistoryRow[]) {
  const uniqueDays = Array.from(
    new Set(
      rows
        .map((row) => row.submittedAt)
        .filter(Boolean)
        .map((value) => new Date(value!).toDateString())
    )
  )
    .map((value) => new Date(value))
    .sort((a, b) => b.getTime() - a.getTime());

  if (uniqueDays.length === 0) return 0;

  let streak = 1;
  for (let index = 1; index < uniqueDays.length; index += 1) {
    const previous = uniqueDays[index - 1];
    const current = uniqueDays[index];
    const diffDays = Math.round((previous.getTime() - current.getTime()) / 86400000);
    if (diffDays === 1) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

export default function HistoryPage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isMobile = width < 700;
  const pageScale = isMobile ? 0.6 : 0.8;

  const [rows, setRows] = useState<HistoryRow[]>(() => peekCachedHistoryRows('') ?? []);
  const [loading, setLoading] = useState(true);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [examFilter, setExamFilter] = useState<'All Exams' | string>('All Exams');
  const [statusFilter, setStatusFilter] = useState<'All Status' | 'Completed' | 'Incomplete'>('All Status');
  const [sortBy, setSortBy] = useState<'Latest' | 'Highest Score' | 'Lowest Score'>('Latest');
  const [mockMetaById, setMockMetaById] = useState<Record<string, { totalMinutes: number; sections: number }>>({});

  const loadHistory = useCallback(async () => {
    try {
      if (!supabase || !hasSupabaseConfig) {
        setSessionUserId(null);
        setRows([]);
        setLoading(false);
        router.replace('/auth');
        return;
      }

      const session = await getCachedSession();
      const userId = session?.user?.id ?? null;
      if (!userId) {
        setSessionUserId(null);
        setRows([]);
        setLoading(false);
        router.replace('/auth');
        return;
      }

      const cachedRows = peekCachedHistoryRows(userId);
      const cachedMocks = peekCachedMockTests();
      setSessionUserId(userId);

      if (cachedRows) {
        setRows(cachedRows);
        setLoading(false);
      } else {
        setLoading(true);
      }

      if (cachedMocks) {
        const nextMeta = Object.fromEntries(
          cachedMocks.map((mock) => [
            mock.id,
            {
              totalMinutes: Math.round(Number(mock.payload.totalTimeSeconds ?? 0) / 60),
              sections: mock.payload.sections.length,
            },
          ])
        );
        setMockMetaById(nextMeta);
      }

      const [mappedRows, mockTests] = await Promise.all([
        getCachedHistoryRows(userId),
        getCachedMockTests(),
      ]);

      setRows(mappedRows);
      setMockMetaById(
        Object.fromEntries(
          mockTests.map((mock) => [
            mock.id,
            {
              totalMinutes: Math.round(Number(mock.payload.totalTimeSeconds ?? 0) / 60),
              sections: mock.payload.sections.length,
            },
          ])
        )
      );
    } catch (error) {
      console.error('Failed to load history page', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
      return undefined;
    }, [loadHistory])
  );

  useEffect(() => {
    if (!supabase) {
      setSessionUserId(null);
      router.replace('/auth');
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      cacheSession(session);
      setSessionUserId(session?.user?.id ?? null);
      if (!session?.user?.id && event === 'SIGNED_OUT') {
        router.replace('/auth');
      }
    });

    return () => data.subscription.unsubscribe();
  }, [router]);

  const examOptions = useMemo(() => ['All Exams', ...Array.from(new Set(rows.map((row) => row.exam)))], [rows]);

  const historyRows = useMemo<EnrichedHistoryRow[]>(() => {
    return rows.map((row) => {
      const meta = mockMetaById[row.testId];
      const totalQuestions = Math.max(1, row.totalQuestions);
      const accuracy = Math.max(0, Math.min(100, Math.round((row.score / totalQuestions) * 100)));
      return {
        ...row,
        totalMinutes: meta?.totalMinutes ?? 0,
        sections: meta?.sections ?? 0,
        accuracy,
        status: row.attempted >= row.totalQuestions ? 'Completed' : 'Incomplete',
      };
    });
  }, [mockMetaById, rows]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    let nextRows = historyRows.filter((row) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        row.title.toLowerCase().includes(normalizedSearch) ||
        row.exam.toLowerCase().includes(normalizedSearch);
      const matchesExam = examFilter === 'All Exams' || row.exam === examFilter;
      const matchesStatus = statusFilter === 'All Status' || row.status === statusFilter;
      return matchesSearch && matchesExam && matchesStatus;
    });

    if (sortBy === 'Highest Score') {
      nextRows = [...nextRows].sort((a, b) => b.accuracy - a.accuracy);
    } else if (sortBy === 'Lowest Score') {
      nextRows = [...nextRows].sort((a, b) => a.accuracy - b.accuracy);
    } else {
      nextRows = [...nextRows].sort((a, b) => {
        const aTime = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
        const bTime = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
        return bTime - aTime;
      });
    }

    return nextRows;
  }, [examFilter, historyRows, searchQuery, sortBy, statusFilter]);

  const overview = useMemo(() => {
    const totalTests = historyRows.length;
    const averageAccuracy =
      totalTests > 0
        ? Math.round(historyRows.reduce((sum, row) => sum + row.accuracy, 0) / totalTests)
        : 0;
    const bestScore = historyRows.reduce((max, row) => Math.max(max, row.score), 0);
    const streak = getCurrentStreak(historyRows);

    return {
      totalTests,
      averageAccuracy,
      bestScore,
      streak,
    };
  }, [historyRows]);

  return (
    <AppChrome active="history">
      {loading || !sessionUserId ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.empty}>{loading ? 'Loading history...' : 'Redirecting to login...'}</Text>
        </View>
      ) : (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={[styles.hero, { borderRadius: scaleValue(34, pageScale), padding: scaleValue(32, pageScale), marginBottom: scaleValue(24, pageScale), gap: scaleValue(16, pageScale) }]}>
          <View style={styles.heroCopy}>
            <Text style={[styles.heroTitle, { fontSize: scaleValue(52, pageScale), lineHeight: scaleValue(54, pageScale) }]}>Your Test History</Text>
            <Text style={[styles.heroSubtitle, { marginTop: scaleValue(8, pageScale), fontSize: scaleValue(18, pageScale), lineHeight: scaleValue(25, pageScale), maxWidth: scaleValue(520, pageScale) }]}>
              Track your progress and see how you&apos;re improving every day!
            </Text>
          </View>
          <Image
            source={heroIllustration}
            style={[
              styles.heroArt,
              isMobile && styles.heroArtMobile,
              isMobile
                ? { width: scaleValue(110, pageScale), height: scaleValue(110, pageScale), top: scaleValue(18, pageScale), right: scaleValue(18, pageScale) }
                : { width: scaleValue(170, pageScale), height: scaleValue(170, pageScale) },
            ]}
            resizeMode="contain"
          />
        </View>

        <View style={[styles.statsGrid, { gap: scaleValue(18, pageScale), marginBottom: scaleValue(24, pageScale) }]}>
          <View style={[styles.statCard, { borderRadius: scaleValue(28, pageScale), padding: scaleValue(22, pageScale), gap: scaleValue(16, pageScale) }]}>
            <View style={[styles.statIcon, styles.statBlue, { width: scaleValue(62, pageScale), height: scaleValue(62, pageScale), borderRadius: scaleValue(20, pageScale) }]}>
              <MaterialCommunityIcons name="clipboard-text-outline" size={26} color="#3B67FF" />
            </View>
            <View>
              <Text style={[styles.statValue, { fontSize: scaleValue(32, pageScale), lineHeight: scaleValue(34, pageScale) }]}>{overview.totalTests}</Text>
              <Text style={[styles.statLabel, { marginTop: scaleValue(4, pageScale), fontSize: scaleValue(14, pageScale) }]}>Tests Attempted</Text>
            </View>
          </View>

          <View style={[styles.statCard, { borderRadius: scaleValue(28, pageScale), padding: scaleValue(22, pageScale), gap: scaleValue(16, pageScale) }]}>
            <View style={[styles.statIcon, styles.statGreen, { width: scaleValue(62, pageScale), height: scaleValue(62, pageScale), borderRadius: scaleValue(20, pageScale) }]}>
              <MaterialCommunityIcons name="target" size={26} color="#31BA59" />
            </View>
            <View>
              <Text style={[styles.statValue, { fontSize: scaleValue(32, pageScale), lineHeight: scaleValue(34, pageScale) }]}>{overview.averageAccuracy}%</Text>
              <Text style={[styles.statLabel, { marginTop: scaleValue(4, pageScale), fontSize: scaleValue(14, pageScale) }]}>Average Accuracy</Text>
            </View>
          </View>

          <View style={[styles.statCard, { borderRadius: scaleValue(28, pageScale), padding: scaleValue(22, pageScale), gap: scaleValue(16, pageScale) }]}>
            <View style={[styles.statIcon, styles.statPurple, { width: scaleValue(62, pageScale), height: scaleValue(62, pageScale), borderRadius: scaleValue(20, pageScale) }]}>
              <MaterialCommunityIcons name="chart-line" size={26} color="#9654FF" />
            </View>
            <View>
              <Text style={[styles.statValue, { fontSize: scaleValue(32, pageScale), lineHeight: scaleValue(34, pageScale) }]}>{overview.bestScore}</Text>
              <Text style={[styles.statLabel, { marginTop: scaleValue(4, pageScale), fontSize: scaleValue(14, pageScale) }]}>Best Score</Text>
            </View>
          </View>

          <View style={[styles.statCard, { borderRadius: scaleValue(28, pageScale), padding: scaleValue(22, pageScale), gap: scaleValue(16, pageScale) }]}>
            <View style={[styles.statIcon, styles.statOrange, { width: scaleValue(62, pageScale), height: scaleValue(62, pageScale), borderRadius: scaleValue(20, pageScale) }]}>
              <MaterialCommunityIcons name="fire" size={26} color="#FF9524" />
            </View>
            <View>
              <Text style={[styles.statValue, { fontSize: scaleValue(32, pageScale), lineHeight: scaleValue(34, pageScale) }]}>{overview.streak}</Text>
              <Text style={[styles.statLabel, { marginTop: scaleValue(4, pageScale), fontSize: scaleValue(14, pageScale) }]}>Current Streak</Text>
            </View>
          </View>
        </View>

        <View style={[styles.filters, { padding: scaleValue(18, pageScale), borderRadius: scaleValue(30, pageScale), gap: scaleValue(16, pageScale), marginBottom: scaleValue(22, pageScale) }]}>
          <View style={[styles.filterBox, styles.searchBox, { minWidth: scaleValue(220, pageScale), height: scaleValue(56, pageScale), borderRadius: scaleValue(18, pageScale), paddingHorizontal: scaleValue(18, pageScale), gap: scaleValue(10, pageScale) }]}>
            <MaterialCommunityIcons name="magnify" size={18} color="#64739D" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search tests..."
              placeholderTextColor="#7E8CB5"
              style={[styles.searchInput, { fontSize: scaleValue(15, pageScale) }]}
            />
          </View>

          <Pressable
            onPress={() => {
              const currentIndex = examOptions.indexOf(examFilter);
              const nextIndex = (currentIndex + 1) % examOptions.length;
              setExamFilter(examOptions[nextIndex]);
            }}
            style={[styles.filterBox, { minWidth: scaleValue(170, pageScale), height: scaleValue(56, pageScale), borderRadius: scaleValue(18, pageScale), paddingHorizontal: scaleValue(18, pageScale) }]}
          >
            <Text style={[styles.filterText, { fontSize: scaleValue(15, pageScale) }]}>{examFilter}</Text>
            <MaterialCommunityIcons name="chevron-down" size={18} color="#64739D" />
          </Pressable>

          <Pressable
            onPress={() =>
              setStatusFilter((current) =>
                current === 'All Status' ? 'Completed' : current === 'Completed' ? 'Incomplete' : 'All Status'
              )
            }
            style={[styles.filterBox, { minWidth: scaleValue(170, pageScale), height: scaleValue(56, pageScale), borderRadius: scaleValue(18, pageScale), paddingHorizontal: scaleValue(18, pageScale) }]}
          >
            <Text style={[styles.filterText, { fontSize: scaleValue(15, pageScale) }]}>{statusFilter}</Text>
            <MaterialCommunityIcons name="chevron-down" size={18} color="#64739D" />
          </Pressable>

          <Pressable
            onPress={() =>
              setSortBy((current) =>
                current === 'Latest' ? 'Highest Score' : current === 'Highest Score' ? 'Lowest Score' : 'Latest'
              )
            }
            style={[styles.filterBox, { minWidth: scaleValue(170, pageScale), height: scaleValue(56, pageScale), borderRadius: scaleValue(18, pageScale), paddingHorizontal: scaleValue(18, pageScale) }]}
          >
            <Text style={[styles.filterText, { fontSize: scaleValue(15, pageScale) }]}>{`Sort by: ${sortBy}`}</Text>
            <MaterialCommunityIcons name="chevron-down" size={18} color="#64739D" />
          </Pressable>
        </View>

        {filteredRows.length === 0 ? <Text style={styles.empty}>No test history found for the current filters.</Text> : null}

        <View style={[styles.historyList, { gap: scaleValue(18, pageScale) }]}>
          {filteredRows.map((row, index) => {
            const examImage = getExamImageSource(row.exam);
            const circleColor = scoreCircleColors[index % scoreCircleColors.length];

            return (
              <Pressable
                key={row.id}
                onPress={() =>
                  router.push({
                    pathname: '/mock-test/[testid]/review',
                    params: { testid: row.testId, attemptId: row.id },
                })
              }
                style={[styles.card, { borderRadius: scaleValue(30, pageScale), padding: scaleValue(24, pageScale), gap: scaleValue(20, pageScale) }]}
              >
                <View style={[styles.cardLeft, { gap: scaleValue(18, pageScale) }]}>
                  <View style={[styles.examIconWrap, { width: scaleValue(78, pageScale), height: scaleValue(78, pageScale), borderRadius: scaleValue(24, pageScale), padding: scaleValue(14, pageScale) }]}>
                    {examImage ? (
                      <Image source={examImage} style={styles.examIcon} resizeMode="cover" />
                    ) : (
                      <MaterialCommunityIcons name="file-document-outline" size={28} color="#3B67FF" />
                    )}
                  </View>

                  <View style={styles.cardInfo}>
                    <Text style={[styles.cardTitle, { fontSize: scaleValue(32, pageScale), lineHeight: scaleValue(34, pageScale), marginBottom: scaleValue(8, pageScale) }]}>{row.title}</Text>
                    <View style={[styles.metaRow, { gap: scaleValue(18, pageScale) }]}>
                      <View style={[styles.metaItem, { gap: scaleValue(6, pageScale) }]}>
                        <MaterialCommunityIcons name="calendar-month-outline" size={15} color="#6C79A0" />
                        <Text style={[styles.metaText, { fontSize: scaleValue(14, pageScale) }]}>{formatDate(row.submittedAt)}</Text>
                      </View>
                      <View style={[styles.metaItem, { gap: scaleValue(6, pageScale) }]}>
                        <MaterialCommunityIcons name="file-document-outline" size={15} color="#6C79A0" />
                        <Text style={[styles.metaText, { fontSize: scaleValue(14, pageScale) }]}>{row.totalQuestions} Qs</Text>
                      </View>
                      <View style={[styles.metaItem, { gap: scaleValue(6, pageScale) }]}>
                        <MaterialCommunityIcons name="clock-outline" size={15} color="#6C79A0" />
                        <Text style={[styles.metaText, { fontSize: scaleValue(14, pageScale) }]}>{row.totalMinutes || '-'} Min</Text>
                      </View>
                      <View style={[styles.metaItem, { gap: scaleValue(6, pageScale) }]}>
                        <MaterialCommunityIcons name="view-grid-outline" size={15} color="#6C79A0" />
                        <Text style={[styles.metaText, { fontSize: scaleValue(14, pageScale) }]}>{row.sections || '-'} Sections</Text>
                      </View>
                    </View>
                  </View>
                </View>

                <View style={[styles.scoreArea, { gap: scaleValue(20, pageScale) }]}>
                  <View style={[styles.scoreMain, { gap: scaleValue(18, pageScale) }]}>
                    <View style={[styles.scoreCircle, { borderColor: circleColor, width: scaleValue(88, pageScale), height: scaleValue(88, pageScale), borderRadius: scaleValue(44, pageScale), borderWidth: Math.max(3, scaleValue(6, pageScale)) }]}>
                      <Text style={[styles.scoreCircleText, { color: circleColor, fontSize: scaleValue(22, pageScale) }]}>{row.accuracy}%</Text>
                    </View>

                    <View style={styles.scoreTextWrap}>
                      <Text style={[styles.scoreValue, { fontSize: scaleValue(28, pageScale), lineHeight: scaleValue(30, pageScale) }]}>{`${row.score} / ${row.totalQuestions}`}</Text>
                      <Text style={[styles.scoreLabel, { marginTop: scaleValue(6, pageScale), fontSize: scaleValue(14, pageScale) }]}>Score</Text>
                    </View>
                  </View>

                  <View style={[styles.scoreActions, { gap: scaleValue(14, pageScale) }]}>
                    <View style={[styles.statusBadge, row.status === 'Completed' ? styles.completeBadge : styles.incompleteBadge, { paddingHorizontal: scaleValue(18, pageScale), paddingVertical: scaleValue(12, pageScale) }]}>
                      <Text style={[styles.statusBadgeText, row.status === 'Completed' ? styles.completeBadgeText : styles.incompleteBadgeText, { fontSize: scaleValue(14, pageScale) }]}>
                        {row.status}
                      </Text>
                    </View>

                    <View style={[styles.arrowBox, { width: scaleValue(52, pageScale), height: scaleValue(52, pageScale), borderRadius: scaleValue(18, pageScale) }]}>
                      <MaterialCommunityIcons name="chevron-right" size={scaleValue(22, pageScale)} color="#6D7AA3" />
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.footerBox, { marginTop: scaleValue(24, pageScale), paddingVertical: scaleValue(20, pageScale), paddingHorizontal: scaleValue(24, pageScale), borderRadius: scaleValue(28, pageScale), gap: scaleValue(18, pageScale) }]}>
          <Image source={footerIllustration} style={[styles.footerImage, { width: scaleValue(70, pageScale), height: scaleValue(70, pageScale) }]} resizeMode="contain" />
          <View style={styles.footerCopy}>
            <Text style={[styles.footerTitle, { fontSize: scaleValue(28, pageScale), lineHeight: scaleValue(30, pageScale), marginBottom: scaleValue(6, pageScale) }]}>Consistency is the key to success!</Text>
            <Text style={[styles.footerText, { fontSize: scaleValue(15, pageScale) }]}>Keep practicing and you&apos;ll achieve your goals.</Text>
          </View>
        </View>
      </ScrollView>
      )}
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F5F7FF',
    padding: 16,
  },
  container: {
    padding: 18,
    paddingBottom: 30,
  },
  hero: {
    backgroundColor: '#FFFFFF',
    borderRadius: 34,
    padding: 32,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#4468FF',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
    marginBottom: 24,
    justifyContent: 'space-between',
    flexDirection: 'row',
    gap: 16,
  },
  heroCopy: {
    flex: 1,
    paddingRight: 12,
  },
  heroTitle: {
    fontSize: 52,
    lineHeight: 54,
    fontWeight: '900',
    color: '#14234F',
  },
  heroSubtitle: {
    marginTop: 8,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '600',
    color: '#61719E',
    maxWidth: 520,
  },
  heroArt: {
    width: 170,
    height: 170,
    alignSelf: 'center',
  },
  heroArtMobile: {
    width: 110,
    height: 110,
    position: 'absolute',
    top: 18,
    right: 18,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
    marginBottom: 24,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: 220,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    shadowColor: '#4468FF',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
  },
  statIcon: {
    width: 62,
    height: 62,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statBlue: { backgroundColor: '#EDF3FF' },
  statGreen: { backgroundColor: '#ECFFF0' },
  statPurple: { backgroundColor: '#F4EBFF' },
  statOrange: { backgroundColor: '#FFF3E5' },
  statValue: {
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '900',
    color: '#14234F',
  },
  statLabel: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '700',
    color: '#6D7AA3',
  },
  filters: {
    backgroundColor: '#FFFFFF',
    padding: 18,
    borderRadius: 30,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 22,
    shadowColor: '#4468FF',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
  },
  filterBox: {
    flex: 1,
    minWidth: 170,
    height: 56,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#EDF2FF',
    paddingHorizontal: 18,
    backgroundColor: '#FBFCFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  searchBox: {
    minWidth: 220,
    justifyContent: 'flex-start',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#64739D',
    paddingVertical: 0,
  },
  filterText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#64739D',
  },
  historyList: {
    gap: 18,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
    shadowColor: '#4468FF',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
  },
  cardLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  examIconWrap: {
    width: 78,
    height: 78,
    borderRadius: 24,
    backgroundColor: '#EEF2FF',
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  examIcon: {
    width: '100%',
    height: '100%',
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '900',
    color: '#14234F',
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6C79A0',
  },
  scoreArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 26,
  },
  scoreMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  scoreTextWrap: {
    justifyContent: 'center',
  },
  scoreActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  scoreCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreCircleText: {
    fontSize: 22,
    fontWeight: '900',
  },
  scoreValue: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '900',
    color: '#14234F',
  },
  scoreLabel: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: '700',
    color: '#6F7BA2',
  },
  statusBadge: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
  },
  completeBadge: {
    backgroundColor: '#EFFFF1',
  },
  incompleteBadge: {
    backgroundColor: '#FFF0F3',
  },
  statusBadgeText: {
    fontSize: 14,
    fontWeight: '800',
  },
  completeBadgeText: {
    color: '#32B54F',
  },
  incompleteBadgeText: {
    color: '#FF4D6F',
  },
  arrowBox: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F7FF',
  },
  footerBox: {
    marginTop: 24,
    backgroundColor: '#FFFFFF',
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    shadowColor: '#4468FF',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
  },
  footerImage: {
    width: 70,
    height: 70,
  },
  footerCopy: {
    flex: 1,
  },
  footerTitle: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '900',
    color: '#14234F',
    marginBottom: 6,
  },
  footerText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6F7BA2',
  },
  empty: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748B',
    fontWeight: '600',
  },
});

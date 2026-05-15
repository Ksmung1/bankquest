import { type Session } from '@supabase/supabase-js';

import { normalizeMockPayload, type LiveMockListItem, type LiveMockPayload } from '@/constants/mock-live-types';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';

type LeaderboardRow = {
  id: string;
  name: string;
  rank_label: string;
  initials: string;
};

type RecentActivityItem = {
  id: string;
  title: string;
  scoreLabel: string;
  timeLabel: string;
};

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

type WeeklyPoint = {
  day: string;
  count: number;
};

type UserDashboardData = {
  testsCompleted: number;
  accuracyPct: number;
  averageScore: number;
  totalTimeSeconds: number;
  activities: RecentActivityItem[];
  weeklyPoints: WeeklyPoint[];
};

type UserProfileData = {
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const mockTitleCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const SESSION_TTL_MS = 30 * 1000;
const NULL_SESSION_TTL_MS = 2 * 1000;
const SESSION_RECOVERY_ATTEMPTS = 4;
const SESSION_RECOVERY_DELAY_MS = 250;
const USER_DASHBOARD_TTL_MS = 60 * 1000;
const HISTORY_TTL_MS = 60 * 1000;
const MOCKS_TTL_MS = 5 * 60 * 1000;
const LEADERBOARD_TTL_MS = 2 * 60 * 1000;

const sessionCache: { entry: CacheEntry<Session | null> | null; pending: Promise<Session | null> | null } = {
  entry: null,
  pending: null,
};

const userDashboardCache = new Map<string, CacheEntry<UserDashboardData>>();
const userDashboardPending = new Map<string, Promise<UserDashboardData>>();
const userHistoryCache = new Map<string, CacheEntry<HistoryRow[]>>();
const userHistoryPending = new Map<string, Promise<HistoryRow[]>>();
const userProfileCache = new Map<string, CacheEntry<UserProfileData>>();
const userProfilePending = new Map<string, Promise<UserProfileData>>();

const mockTestsCache: { entry: CacheEntry<LiveMockListItem[]> | null; pending: Promise<LiveMockListItem[]> | null } = {
  entry: null,
  pending: null,
};

const mockTestByIdCache = new Map<string, CacheEntry<LiveMockPayload | null>>();
const mockTestByIdPending = new Map<string, Promise<LiveMockPayload | null>>();

const leaderboardCache: { entry: CacheEntry<LeaderboardRow[]> | null; pending: Promise<LeaderboardRow[]> | null } = {
  entry: null,
  pending: null,
};

function isFresh<T>(entry: CacheEntry<T> | null | undefined) {
  return Boolean(entry && entry.expiresAt > Date.now());
}

function formatAttemptTime(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function clearAppDataCache() {
  sessionCache.entry = null;
  sessionCache.pending = null;
  userDashboardCache.clear();
  userDashboardPending.clear();
  userHistoryCache.clear();
  userHistoryPending.clear();
  userProfileCache.clear();
  userProfilePending.clear();
  mockTestsCache.entry = null;
  mockTestsCache.pending = null;
  mockTestByIdCache.clear();
  mockTestByIdPending.clear();
  leaderboardCache.entry = null;
  leaderboardCache.pending = null;
}

export function invalidateUserDashboardCache(userId?: string | null) {
  if (!userId) {
    userDashboardCache.clear();
    userDashboardPending.clear();
    return;
  }
  userDashboardCache.delete(userId);
  userDashboardPending.delete(userId);
}

export function invalidateHistoryCache(userId?: string | null) {
  if (!userId) {
    userHistoryCache.clear();
    userHistoryPending.clear();
    return;
  }
  userHistoryCache.delete(userId);
  userHistoryPending.delete(userId);
}

export function invalidateUserProfileCache(userId?: string | null) {
  if (!userId) {
    userProfileCache.clear();
    userProfilePending.clear();
    return;
  }
  userProfileCache.delete(userId);
  userProfilePending.delete(userId);
}

export function invalidateMockTestsCache(testId?: string | null) {
  mockTestsCache.entry = null;
  mockTestsCache.pending = null;
  if (testId) {
    mockTestByIdCache.delete(testId);
    mockTestByIdPending.delete(testId);
  } else {
    mockTestByIdCache.clear();
    mockTestByIdPending.clear();
  }
}

export function invalidateLeaderboardCache() {
  leaderboardCache.entry = null;
  leaderboardCache.pending = null;
}

export function prewarmAppData(userId?: string | null) {
  if (!userId) {
    void getCachedMockTests().catch(() => undefined);
    return;
  }

  void Promise.allSettled([
    getCachedMockTests(),
    getCachedUserProfile(userId),
    getCachedUserDashboardData(userId),
    getCachedHistoryRows(userId),
  ]);
}

export async function getCachedSession() {
  if (!supabase || !hasSupabaseConfig) {
    return null;
  }

  if (isFresh(sessionCache.entry) && sessionCache.entry!.data) {
    return sessionCache.entry!.data;
  }

  if (sessionCache.pending) {
    return sessionCache.pending;
  }

  sessionCache.pending = (async () => {
      let session: Session | null = null;

      for (let attempt = 0; attempt < SESSION_RECOVERY_ATTEMPTS; attempt += 1) {
        const { data } = await supabase.auth.getSession();
        session = data.session ?? null;

        if (session?.user?.id) {
          break;
        }

        const isBrowserRuntime = typeof window !== 'undefined';
        if (!isBrowserRuntime || attempt === SESSION_RECOVERY_ATTEMPTS - 1) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, SESSION_RECOVERY_DELAY_MS));
      }

      sessionCache.entry = {
        data: session,
        expiresAt: Date.now() + SESSION_TTL_MS,
      };
      return session;
    })()
    .catch((error) => {
      console.error('Failed to load session', error);
      return null;
    })
    .finally(() => {
      sessionCache.pending = null;
    }) as Promise<Session | null>;

  return sessionCache.pending;
}

export function cacheSession(session: Session | null) {
  sessionCache.entry = {
    data: session,
    expiresAt: Date.now() + (session ? SESSION_TTL_MS : NULL_SESSION_TTL_MS),
  };
}

export async function getCachedMockTests() {
  if (!supabase || !hasSupabaseConfig) {
    return [] as LiveMockListItem[];
  }

  if (isFresh(mockTestsCache.entry)) {
    return mockTestsCache.entry!.data;
  }

  if (mockTestsCache.pending) {
    return mockTestsCache.pending;
  }

  mockTestsCache.pending = (async () => {
    try {
      const testsRes = await supabase
        .from('mock_tests')
        .select('id,title,exam,payload')
        .order('title', { ascending: true });

      const mapped: LiveMockListItem[] = !testsRes.error && testsRes.data
        ? testsRes.data
            .filter((r) => Boolean(r.payload))
            .map((r) => ({
              id: String(r.id),
              title: String(r.title ?? (r.payload as LiveMockPayload).title ?? 'Mock Test'),
              exam: String(r.exam ?? (r.payload as LiveMockPayload).exam ?? 'Exam'),
              source: 'live',
              payload: normalizeMockPayload(r.payload as LiveMockPayload),
            }))
        : [];

      mapped.sort((a, b) => {
        const examCompare = mockTitleCollator.compare(a.exam, b.exam);
        if (examCompare !== 0) return examCompare;

        const titleCompare = mockTitleCollator.compare(a.title, b.title);
        if (titleCompare !== 0) return titleCompare;

        return mockTitleCollator.compare(a.id, b.id);
      });

      const expiresAt = Date.now() + MOCKS_TTL_MS;
      mockTestsCache.entry = { data: mapped, expiresAt };
      for (const item of mapped) {
        mockTestByIdCache.set(item.id, { data: item.payload, expiresAt });
      }
      return mapped;
    } catch (error) {
      console.error('Failed to load mock tests', error);
      mockTestsCache.entry = { data: [], expiresAt: Date.now() + 15 * 1000 };
      return [] as LiveMockListItem[];
    } finally {
      mockTestsCache.pending = null;
    }
  })();

  return mockTestsCache.pending;
}

export function peekCachedMockTests() {
  if (!isFresh(mockTestsCache.entry)) {
    return null;
  }
  return mockTestsCache.entry!.data;
}

export async function getCachedMockTestById(testId: string) {
  const cached = mockTestByIdCache.get(testId);
  if (isFresh(cached)) {
    return cached!.data;
  }

  if (mockTestByIdPending.has(testId)) {
    return mockTestByIdPending.get(testId)!;
  }

  const pending = (async () => {
    const allTests = await getCachedMockTests();
    const fromList = allTests.find((item) => item.id === testId)?.payload ?? null;
    if (fromList) {
      mockTestByIdPending.delete(testId);
      return fromList;
    }

    if (!supabase || !hasSupabaseConfig) {
      mockTestByIdPending.delete(testId);
      return null;
    }

    const testRes = await supabase.from('mock_tests').select('payload').eq('id', testId).single();
    const payload = !testRes.error && testRes.data?.payload ? normalizeMockPayload(testRes.data.payload as LiveMockPayload) : null;
    mockTestByIdCache.set(testId, {
      data: payload,
      expiresAt: Date.now() + MOCKS_TTL_MS,
    });
    mockTestByIdPending.delete(testId);
    return payload;
  })();

  mockTestByIdPending.set(testId, pending);
  return pending;
}

export async function getCachedLeaderboardPreview() {
  if (!supabase || !hasSupabaseConfig) {
    return [] as LeaderboardRow[];
  }

  if (isFresh(leaderboardCache.entry)) {
    return leaderboardCache.entry!.data;
  }

  if (leaderboardCache.pending) {
    return leaderboardCache.pending;
  }

  leaderboardCache.pending = (async () => {
    const { data: statsRows, error } = await supabase
      .from('user_stats')
      .select('user_id,global_rank,total_score')
      .order('total_score', { ascending: false })
      .limit(4);

    if (error || !statsRows || statsRows.length === 0) {
      leaderboardCache.entry = { data: [], expiresAt: Date.now() + LEADERBOARD_TTL_MS };
      leaderboardCache.pending = null;
      return [];
    }

    const userIds = statsRows.map((r) => String(r.user_id));
    const { data: profiles } = await supabase.from('user_profiles').select('user_id,username,display_name').in('user_id', userIds);
    const profileMap = new Map((profiles ?? []).map((p) => [String(p.user_id), { username: String(p.username ?? '').trim(), displayName: String(p.display_name ?? 'User') }]));

    const rows = statsRows.map((row) => {
      const uid = String(row.user_id);
      const profile = profileMap.get(uid);
      const displayName = profile?.username || profile?.displayName || 'User';
      const initials = displayName
        .split(' ')
        .map((s) => s[0])
        .join('')
        .slice(0, 2)
        .toUpperCase() || 'U';
      return {
        id: uid,
        name: displayName,
        rank_label: row.global_rank ? `#${row.global_rank}` : `${Number(row.total_score ?? 0)} pts`,
        initials,
      };
    });

    leaderboardCache.entry = {
      data: rows,
      expiresAt: Date.now() + LEADERBOARD_TTL_MS,
    };
    leaderboardCache.pending = null;
    return rows;
  })();

  return leaderboardCache.pending;
}

export function peekCachedHistoryRows(userId: string) {
  const cached = userHistoryCache.get(userId);
  if (!isFresh(cached)) {
    return null;
  }
  return cached!.data;
}

export async function getCachedHistoryRows(userId: string) {
  const cached = userHistoryCache.get(userId);
  if (isFresh(cached)) {
    return cached!.data;
  }

  if (userHistoryPending.has(userId)) {
    return userHistoryPending.get(userId)!;
  }

  if (!supabase || !hasSupabaseConfig) {
    return [] as HistoryRow[];
  }

  const pending = Promise.all([
    supabase
      .from('mock_test_attempts')
      .select('id,test_id,score_total,total_questions,attempted_total,submitted_at')
      .eq('user_id', userId)
      .order('submitted_at', { ascending: false }),
    getCachedMockTests(),
  ])
    .then(([attemptsRes, mockTests]) => {
      const testMap = new Map(
        mockTests.map((item) => [
          item.id,
          {
            title: item.title,
            exam: item.exam,
          },
        ])
      );

      const mapped: HistoryRow[] = (attemptsRes.data ?? []).map((row) => {
        const meta = testMap.get(String(row.test_id));
        return {
          id: String(row.id),
          testId: String(row.test_id),
          title: meta?.title ?? String(row.test_id ?? 'Mock Test'),
          exam: meta?.exam ?? 'Exam',
          score: Number(row.score_total ?? 0),
          totalQuestions: Number(row.total_questions ?? 0),
          attempted: Number(row.attempted_total ?? 0),
          submittedAt: row.submitted_at ? String(row.submitted_at) : null,
        };
      });

      userHistoryCache.set(userId, {
        data: mapped,
        expiresAt: Date.now() + HISTORY_TTL_MS,
      });
      return mapped;
    })
    .catch((error) => {
      console.error('Failed to load history rows', error);
      return [] as HistoryRow[];
    })
    .finally(() => {
      userHistoryPending.delete(userId);
    });

  userHistoryPending.set(userId, pending);
  return pending;
}

export async function getCachedUserProfile(userId: string) {
  const cached = userProfileCache.get(userId);
  if (isFresh(cached)) {
    return cached!.data;
  }

  if (userProfilePending.has(userId)) {
    return userProfilePending.get(userId)!;
  }

  if (!supabase || !hasSupabaseConfig) {
    return { username: null, displayName: null, avatarUrl: null } as UserProfileData;
  }

  const pending = (async () => {
    try {
      const res = await supabase
        .from('user_profiles')
        .select('username,display_name,avatar_url')
        .eq('user_id', userId)
        .maybeSingle();

      const result: UserProfileData = {
        username: res.data?.username ? String(res.data.username).trim() : null,
        displayName: res.data?.display_name ? String(res.data.display_name).trim() : null,
        avatarUrl: (res.data?.avatar_url as string | null) ?? null,
      };
      userProfileCache.set(userId, {
        data: result,
        expiresAt: Date.now() + USER_DASHBOARD_TTL_MS,
      });
      return result;
    } catch (error) {
      console.error('Failed to load user profile', error);
      return { username: null, displayName: null, avatarUrl: null } as UserProfileData;
    } finally {
      userProfilePending.delete(userId);
    }
  })();

  userProfilePending.set(userId, pending);
  return pending;
}

export async function getCachedUserDashboardData(userId: string) {
  const cached = userDashboardCache.get(userId);
  if (isFresh(cached)) {
    return cached!.data;
  }

  if (userDashboardPending.has(userId)) {
    return userDashboardPending.get(userId)!;
  }

  if (!supabase || !hasSupabaseConfig) {
    return {
      testsCompleted: 0,
      accuracyPct: 0,
      averageScore: 0,
      totalTimeSeconds: 0,
      activities: [],
      weeklyPoints: [
        { day: 'S', count: 0 },
        { day: 'M', count: 0 },
        { day: 'T', count: 0 },
        { day: 'W', count: 0 },
        { day: 'T', count: 0 },
        { day: 'F', count: 0 },
        { day: 'S', count: 0 },
      ],
    } as UserDashboardData;
  }

  const pending = Promise.all([
    supabase.from('user_stats').select('tests_taken,avg_accuracy').eq('user_id', userId).maybeSingle(),
    supabase.from('mock_test_attempts').select('id,test_id,score_total,attempted_total,time_spent_seconds,section_seconds_left,submitted_at').eq('user_id', userId).order('submitted_at', { ascending: false }),
    getCachedMockTests(),
  ])
    .then(([statsRes, attemptsRes, mockTests]) => {
      const stats = statsRes.data;
      const attempts = attemptsRes.data ?? [];
      const testsCompleted = Number(stats?.tests_taken ?? 0);
      const accuracyPct = Math.max(0, Math.min(100, Math.round(Number(stats?.avg_accuracy ?? 0))));
      const mockById = new Map(mockTests.map((mock) => [String(mock.id), mock]));
      const averageScore = attempts.length > 0
        ? Math.round(
            attempts.reduce((sum, row) => sum + Number((row as { score_total?: number | null }).score_total ?? 0), 0) / attempts.length
          )
        : 0;

      const totalTimeSeconds = attempts.reduce((sum, row) => {
        const rec = row as {
          test_id?: string | null;
          time_spent_seconds?: number | null;
          section_seconds_left?: Record<string, number> | null;
        };
        const recordedSeconds = Number(rec.time_spent_seconds ?? 0);
        if (recordedSeconds > 0) {
          return sum + recordedSeconds;
        }

        const mock = rec.test_id ? mockById.get(String(rec.test_id)) : undefined;
        if (!mock?.payload) {
          return sum;
        }

        const totalBudgetSeconds = Math.max(
          Number(mock.payload.totalTimeSeconds ?? 0),
          (mock.payload.sections ?? []).reduce((sectionSum, section) => sectionSum + Number(section.timeSeconds ?? 0), 0)
        );
        const remainingSeconds = Object.values(rec.section_seconds_left ?? {}).reduce((remainingSum, value) => remainingSum + Number(value ?? 0), 0);
        return sum + Math.max(0, totalBudgetSeconds - remainingSeconds);
      }, 0);

      const activities = attempts.slice(0, 3).map((row) => {
        const rec = row as { id: string; test_id?: string | null; score_total?: number | null; attempted_total?: number | null; submitted_at?: string | null };
        const mock = rec.test_id ? mockById.get(String(rec.test_id)) : undefined;
        const title = mock?.title ?? String(rec.test_id ?? 'Mock Test');
        const fullMarks = Number(mock?.payload?.totalMarks ?? rec.attempted_total ?? 0);
        return {
          id: rec.id,
          title,
          scoreLabel: `${Number(rec.score_total ?? 0)}/${fullMarks}`,
          timeLabel: rec.submitted_at ? formatAttemptTime(rec.submitted_at) : 'Recently',
        };
      });

      const weekly = [0, 0, 0, 0, 0, 0, 0];
      for (const row of attempts) {
        const submittedAt = (row as { submitted_at?: string | null }).submitted_at;
        if (!submittedAt) continue;
        weekly[new Date(submittedAt).getDay()] += 1;
      }

      const result: UserDashboardData = {
        testsCompleted,
        accuracyPct,
        averageScore,
        totalTimeSeconds,
        activities,
        weeklyPoints: [
          { day: 'S', count: weekly[0] },
          { day: 'M', count: weekly[1] },
          { day: 'T', count: weekly[2] },
          { day: 'W', count: weekly[3] },
          { day: 'T', count: weekly[4] },
          { day: 'F', count: weekly[5] },
          { day: 'S', count: weekly[6] },
        ],
      };

      userDashboardCache.set(userId, {
        data: result,
        expiresAt: Date.now() + USER_DASHBOARD_TTL_MS,
      });
      return result;
    })
    .catch((error) => {
      console.error('Failed to load user dashboard data', error);
      return {
        testsCompleted: 0,
        accuracyPct: 0,
        averageScore: 0,
        totalTimeSeconds: 0,
        activities: [],
        weeklyPoints: [
          { day: 'S', count: 0 },
          { day: 'M', count: 0 },
          { day: 'T', count: 0 },
          { day: 'W', count: 0 },
          { day: 'T', count: 0 },
          { day: 'F', count: 0 },
          { day: 'S', count: 0 },
        ],
      } as UserDashboardData;
    })
    .finally(() => {
      userDashboardPending.delete(userId);
    });

  userDashboardPending.set(userId, pending);
  return pending;
}

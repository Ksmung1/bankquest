import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { flattenSectionQuestions, getImageUrl, normalizeSubject, type FlattenedLiveQuestion, type LiveMockPayload } from '@/constants/mock-live-types';
import { cacheSession, getCachedMockTestById, getCachedSession, getCachedUserProfile, invalidateHistoryCache, invalidateLeaderboardCache, invalidateMockTestsCache, invalidateUserDashboardCache } from '@/lib/app-data-cache';
import { saveLocalMockAttempt } from '@/lib/local-mock-data';
import { clearPausedMockAttempt, getPausedMockAttempt, setPausedMockAttempt } from '@/lib/mock-test-resume';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { trackActivity } from '@/lib/portal-bridge';

type OptionKey = 'A' | 'B' | 'C' | 'D';
type SubmitStage = 'confirm' | 'submitting' | 'evaluating';
type SubjectName = string;
const SUBMIT_TIMEOUT_MS = 15000;
const OVERALL_TIMER_KEY = '__overall__';

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function formatSubmitError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'object' && error !== null) {
    const maybeMessage = 'message' in error ? error.message : null;
    const maybeDetails = 'details' in error ? error.details : null;
    const maybeHint = 'hint' in error ? error.hint : null;
    const parts = [maybeMessage, maybeDetails, maybeHint].filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
    if (parts.length > 0) {
      return parts.join(' ').trim();
    }
  }

  return 'We could not save your test result. Please try again.';
}

function InlineImage({ uri, style }: { uri?: string | null; style: object }) {
  if (!uri) return null;
  return <Image source={{ uri }} style={style} resizeMode="contain" />;
}

export default function MockTestDetailPage() {
  const { testid, resume } = useLocalSearchParams<{ testid: string; resume?: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const scrollRef = useRef<ScrollView | null>(null);
  const allowLeaveRef = useRef(false);

  const [payload, setPayload] = useState<LiveMockPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  const [subjectIndex, setSubjectIndex] = useState(0);
  const [questionIndexBySubject, setQuestionIndexBySubject] = useState<Record<string, number>>({});
  const [answers, setAnswers] = useState<Record<string, OptionKey>>({});
  const [covered, setCovered] = useState<Record<string, true>>({});
  const [savedForReview, setSavedForReview] = useState<Record<string, true>>({});
  const [showPalette, setShowPalette] = useState(false);
  const [allowLeave, setAllowLeave] = useState(false);
  const [sectionSecondsLeft, setSectionSecondsLeft] = useState<Record<string, number>>({});
  const [showSubmitFlow, setShowSubmitFlow] = useState(false);
  const [submitStage, setSubmitStage] = useState<SubmitStage>('confirm');

  useEffect(() => {
    allowLeaveRef.current = allowLeave;
  }, [allowLeave]);

  const subjects = useMemo(() => {
    if (!payload) return [] as SubjectName[];
    return payload.sections.map((s) => normalizeSubject(s.name));
  }, [payload]);

  const sectionBySubject = useMemo(() => {
    if (!payload) return {} as Record<string, LiveMockPayload['sections'][number]>;
    const map: Record<string, LiveMockPayload['sections'][number]> = {};
    payload.sections.forEach((s) => {
      map[normalizeSubject(s.name)] = s;
    });
    return map;
  }, [payload]);

  const flattenedQuestionsBySubject = useMemo(() => {
    if (!payload) return {} as Record<string, FlattenedLiveQuestion[]>;
    const map: Record<string, FlattenedLiveQuestion[]> = {};
    let globalOffset = 0;
    for (const section of payload.sections) {
      const subjectName = normalizeSubject(section.name);
      const flattened = flattenSectionQuestions(section, globalOffset);
      map[subjectName] = flattened;
      globalOffset += flattened.length;
    }
    return map;
  }, [payload]);

  const currentSubject = subjects[subjectIndex] ?? '';
  const currentQuestions: FlattenedLiveQuestion[] = flattenedQuestionsBySubject[currentSubject] ?? [];
  const currentQuestionIndex = questionIndexBySubject[currentSubject] ?? 0;
  const currentQuestion = currentQuestions[currentQuestionIndex];
  const hasSectionalTiming = payload?.sectionalTiming !== false;

  const totalQuestions = useMemo(() => Object.values(flattenedQuestionsBySubject).reduce((sum, questions) => sum + questions.length, 0), [flattenedQuestionsBySubject]);
  const subjectTotalQuestions = currentQuestions.length;
  const subjectQuestionNumber = currentQuestionIndex + 1;
  const answerKey = currentQuestion?.answerKey ?? '';
  const selected = answers[answerKey] ?? null;

  const isFirstQuestion = currentQuestionIndex === 0;
  const isFirstNavigableQuestion = hasSectionalTiming ? isFirstQuestion : subjectIndex === 0 && isFirstQuestion;
  const isLastQuestionInSubject = currentQuestionIndex === subjectTotalQuestions - 1;
  const isFinalQuestion = subjectIndex === subjects.length - 1 && isLastQuestionInSubject;

  useEffect(() => {
    async function init() {
      let loadedPayload: LiveMockPayload | null = null;

      if (!supabase || !hasSupabaseConfig) {
        setSessionUserId(null);
      } else {
        const session = await getCachedSession();
        setSessionUserId(session?.user?.id ?? null);
      }

      loadedPayload = await getCachedMockTestById(String(testid));

      if (loadedPayload) {
        const p = loadedPayload;
        setPayload(p);

        const initialQuestionIndexBySubject: Record<string, number> = {};
        const initialCovered: Record<string, true> = {};
        const initialTimers: Record<string, number> = {};

        p.sections.forEach((s, idx) => {
          const sn = normalizeSubject(s.name);
          initialQuestionIndexBySubject[sn] = 0;
          if (p.sectionalTiming !== false) {
            initialTimers[sn] = Number(s.timeSeconds ?? 1200);
          }
          const firstQuestion = flattenSectionQuestions(s)[0];
          if (idx === 0 && firstQuestion) {
            initialCovered[firstQuestion.answerKey] = true;
          }
        });

        if (p.sectionalTiming === false) {
          initialTimers[OVERALL_TIMER_KEY] = Number(p.totalTimeSeconds ?? 0);
        }

        setQuestionIndexBySubject(initialQuestionIndexBySubject);
        setCovered(initialCovered);
        setSectionSecondsLeft(initialTimers);

        const paused = await getPausedMockAttempt();
        if (paused && paused.testId === String(testid)) {
          setSubjectIndex(paused.subjectIndex ?? 0);
          setQuestionIndexBySubject(paused.questionIndexBySubject ?? initialQuestionIndexBySubject);
          setAnswers(paused.answers ?? {});
          setCovered(paused.covered ?? initialCovered);
          setSavedForReview(paused.savedForReview ?? {});
          setSectionSecondsLeft(paused.sectionSecondsLeft ?? initialTimers);
        }
      }

      setLoading(false);
    }

    init();
  }, [resume, router, testid]);

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

  useEffect(() => {
    const activeTimerKey = hasSectionalTiming ? currentSubject : OVERALL_TIMER_KEY;
    if (!activeTimerKey) return;
    const timer = setInterval(() => {
      setSectionSecondsLeft((prev) => {
        const cur = prev[activeTimerKey] ?? 0;
        if (cur <= 0) return prev;
        return { ...prev, [activeTimerKey]: cur - 1 };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [currentSubject, hasSectionalTiming]);

  const maxUnlockedSubjectIndex = useMemo(() => {
    if (!hasSectionalTiming) {
      return Math.max(0, subjects.length - 1);
    }
    let unlocked = 0;
    for (let i = 0; i < subjects.length - 1; i += 1) {
      const s = subjects[i];
      const ql = flattenedQuestionsBySubject[s] ?? [];
      const allCovered = ql.every((question) => covered[question.answerKey]);
      if (allCovered) unlocked = i + 1;
      else break;
    }
    return unlocked;
  }, [covered, flattenedQuestionsBySubject, subjects]);

  const markCurrentCovered = () => {
    if (!currentQuestion?.answerKey) return;
    setCovered((prev) => ({ ...prev, [currentQuestion.answerKey]: true }));
  };

  const onPrev = () => {
    if (!hasSectionalTiming && isFirstQuestion && subjectIndex > 0) {
      markCurrentCovered();
      const previousSubject = subjects[subjectIndex - 1];
      const previousQuestions = flattenedQuestionsBySubject[previousSubject] ?? [];
      const previousIndex = Math.max(0, previousQuestions.length - 1);
      setSubjectIndex(subjectIndex - 1);
      setQuestionIndexBySubject((prev) => ({ ...prev, [previousSubject]: previousIndex }));
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      });
      return;
    }
    if (isFirstQuestion) return;
    markCurrentCovered();
    setQuestionIndexBySubject((prev) => ({ ...prev, [currentSubject]: currentQuestionIndex - 1 }));
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  };

  const onNext = () => {
    markCurrentCovered();
    if (!isLastQuestionInSubject) {
      setQuestionIndexBySubject((prev) => ({ ...prev, [currentSubject]: currentQuestionIndex + 1 }));
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      });
      return;
    }
    if (subjectIndex < subjects.length - 1) {
      const nextSubject = subjects[subjectIndex + 1];
      setSubjectIndex(subjectIndex + 1);
      const firstQuestion = flattenedQuestionsBySubject[nextSubject]?.[0];
      if (firstQuestion) {
        setCovered((prev) => ({ ...prev, [firstQuestion.answerKey]: true }));
      }
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      });
    }
  };

  const onChangeSubject = (targetIndex: number) => {
    if (hasSectionalTiming && targetIndex < subjectIndex) {
      Alert.alert('Locked', 'Once you move to the next section, you cannot revisit a previous section.');
      return;
    }
    if (hasSectionalTiming && targetIndex > maxUnlockedSubjectIndex) {
      Alert.alert('Locked', 'Complete or cover all questions in current subject before moving to next subject.');
      return;
    }
    markCurrentCovered();
    const target = subjects[targetIndex];
    setSubjectIndex(targetIndex);
    const targetQuestion = flattenedQuestionsBySubject[target]?.[questionIndexBySubject[target] ?? 0];
    if (targetQuestion) {
      setCovered((prev) => ({ ...prev, [targetQuestion.answerKey]: true }));
    }
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  };

  const jumpToQuestion = (idx: number) => {
    setQuestionIndexBySubject((prev) => ({ ...prev, [currentSubject]: idx }));
    const jumpedQuestion = currentQuestions[idx];
    if (jumpedQuestion) {
      setCovered((prev) => ({ ...prev, [jumpedQuestion.answerKey]: true }));
    }
    setShowPalette(false);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  };

  const moveToNextSubject = () => {
    if (subjectIndex >= subjects.length - 1) return;
    markCurrentCovered();
    const nextSubject = subjects[subjectIndex + 1];
    setSubjectIndex(subjectIndex + 1);
    const firstQuestion = flattenedQuestionsBySubject[nextSubject]?.[0];
    if (firstQuestion) {
      setCovered((prev) => ({ ...prev, [firstQuestion.answerKey]: true }));
    }
    setShowPalette(false);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  };

  const computeScores = () => {
    const bySubject = subjects.map((s) => {
      const qs = flattenedQuestionsBySubject[s] ?? [];
      let correct = 0;
      let attempted = 0;
      let score = 0;
      const marksPerQuestion = Number(sectionBySubject[s]?.marksPerQuestion ?? 1);
      const negativeMarking = Number(sectionBySubject[s]?.negativeMarking ?? 0);
      qs.forEach((q) => {
        const ans = answers[q.answerKey];
        if (ans) {
          attempted += 1;
          if (ans === q.correctAnswer) {
            correct += 1;
            score += marksPerQuestion;
          } else {
            score -= negativeMarking;
          }
        }
      });
      return { subject: s, correct, attempted, total: qs.length, score: Number(score.toFixed(2)) };
    });

    const totalCorrect = bySubject.reduce((sum, x) => sum + x.correct, 0);
    const totalAttempted = bySubject.reduce((sum, x) => sum + x.attempted, 0);
    const totalScore = Number(bySubject.reduce((sum, x) => sum + x.score, 0).toFixed(2));
    return { bySubject, totalCorrect, totalAttempted, totalScore, total: totalQuestions };
  };

  const getAttemptTimeSpentSeconds = () => {
    const totalRemainingSeconds = Object.values(sectionSecondsLeft).reduce((sum, s) => sum + Number(s ?? 0), 0);
    const sectionBudgetSeconds = payload?.sections?.reduce((sum, section) => sum + Number(section.timeSeconds ?? 0), 0) ?? 0;
    const configuredTotalSeconds = Number(payload?.totalTimeSeconds ?? 0);
    const totalBudgetSeconds = Math.max(configuredTotalSeconds, sectionBudgetSeconds);
    return Math.max(0, totalBudgetSeconds - totalRemainingSeconds);
  };

  const goToReview = async () => {
    const scores = computeScores();
    const timeSpentSeconds = getAttemptTimeSpentSeconds();
    const commonAttemptPayload = {
      answers,
      covered,
      saved_for_review: savedForReview,
      section_seconds_left: sectionSecondsLeft,
      time_spent_seconds: timeSpentSeconds,
      score_total: scores.totalScore,
      attempted_total: scores.totalAttempted,
      total_questions: scores.total,
      subject_scores: scores.bySubject,
    };

    if (!sessionUserId) {
      const localAttempt = await saveLocalMockAttempt({
        testId: String(testid),
        ...commonAttemptPayload,
      });
      await clearPausedMockAttempt();
      allowLeaveRef.current = true;
      setAllowLeave(true);
      setShowSubmitFlow(false);
      router.replace({
        pathname: '/mock-test/[testid]/review',
        params: {
          testid: String(testid),
          localAttemptId: localAttempt.id,
        },
      });
      return;
    }

    const attemptPayload = {
      test_id: String(testid),
      user_id: sessionUserId,
      ...commonAttemptPayload,
    };

    if (!supabase) {
      throw new Error('Supabase client is unavailable. Please try again.');
    }

    const { data: attemptInsert, error: attemptError } = await withTimeout(
      supabase
        .from('mock_test_attempts')
        .insert(attemptPayload)
        .select('id')
        .single(),
      SUBMIT_TIMEOUT_MS,
      'Test submission'
    );

    if (attemptError) {
      throw attemptError;
    }

    try {
      const profile = await getCachedUserProfile(sessionUserId);

      const { error: leaderboardError } = await withTimeout(
        supabase.from('mock_test_leaderboard').upsert(
          {
            test_id: String(testid),
            user_id: sessionUserId,
            user_name: String(profile.username ?? profile.displayName ?? sessionUserId.slice(0, 8)),
            avatar_url: profile.avatarUrl ?? null,
            score: scores.totalScore,
          },
          { onConflict: 'test_id,user_id' }
        ),
        SUBMIT_TIMEOUT_MS,
        'Leaderboard update'
      );

      if (leaderboardError) {
        console.error('Failed to upsert mock_test_leaderboard', leaderboardError);
      }
    } catch (leaderboardError) {
      console.error('Failed to finalize leaderboard update', leaderboardError);
    }

    try {
      await trackActivity(sessionUserId, {
        type: 'mock_test_completed',
        projectName: 'Bank & SSC',
        attemptId: String(attemptInsert?.id ?? ''),
        testId: String(testid),
        testTitle: String(payload?.title ?? testid),
        scoreTotal: scores.totalScore,
        attemptedTotal: scores.totalAttempted,
        totalQuestions: scores.total,
        timeSpentSeconds,
      });
    } catch (syncError) {
      console.error('Failed to sync Website A activity', syncError);
    }

    invalidateUserDashboardCache(sessionUserId);
    invalidateHistoryCache(sessionUserId);
    invalidateLeaderboardCache();
    invalidateMockTestsCache(String(testid));
    await clearPausedMockAttempt();
    allowLeaveRef.current = true;
    setAllowLeave(true);
    setShowSubmitFlow(false);
    router.replace({
      pathname: '/mock-test/[testid]/review',
      params: {
        testid: String(testid),
        attemptId: String(attemptInsert?.id ?? ''),
      },
    });
  };

  const startSubmitFlow = () => {
    markCurrentCovered();
    setShowSubmitFlow(true);
    setSubmitStage('confirm');
  };

  useEffect(() => {
    if (!hasSectionalTiming || typeof window === 'undefined') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || showSubmitFlow) return;
      event.preventDefault();
      setShowPalette(true);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasSectionalTiming, showSubmitFlow]);

  const confirmAndSubmit = async () => {
    if (submitStage === 'submitting') return;
    setSubmitStage('submitting');
    try {
      await goToReview();
    } catch (error) {
      console.error('Failed to submit mock test', error);
      setSubmitStage('confirm');
      setShowSubmitFlow(false);
      Alert.alert('Submit failed', formatSubmitError(error));
    }
  };

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (allowLeaveRef.current) return;
      e.preventDefault();
      startSubmitFlow();
    });
    return unsub;
  }, [navigation]);

  useEffect(() => {
    if (!payload || !testid) return;
    setPausedMockAttempt({
      testId: String(testid),
      testTitle: String(payload.title ?? 'Mock Test'),
      exam: String(payload.exam ?? ''),
      subjectIndex,
      questionIndexBySubject,
      answers,
      covered,
      savedForReview,
      sectionSecondsLeft,
      updatedAt: new Date().toISOString(),
    }).catch(() => undefined);
  }, [answers, covered, payload, questionIndexBySubject, savedForReview, sectionSecondsLeft, subjectIndex, testid]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#2563EB" /><Text style={styles.centerText}>Loading test...</Text></View>;
  }

  if (!payload || !currentQuestion) {
    return <View style={styles.center}><Text style={styles.centerText}>Mock test data is not available on this device.</Text></View>;
  }

  const activeSecondsLeft = hasSectionalTiming
    ? (sectionSecondsLeft[currentSubject] ?? 0)
    : (sectionSecondsLeft[OVERALL_TIMER_KEY] ?? Number(payload.totalTimeSeconds ?? 0));
  const hrs = Math.floor(activeSecondsLeft / 3600);
  const mins = Math.floor((activeSecondsLeft % 3600) / 60);
  const secs = activeSecondsLeft % 60;
  const timerText = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const directionImageUrl = currentQuestion?.direction?.imageUrl ?? null;
  const questionImageUrl = getImageUrl(currentQuestion?.image, currentQuestion?.imageUrl);
  const questionDisplayNumber = hasSectionalTiming ? subjectQuestionNumber : currentQuestion.globalIndex + 1;
  const questionDisplayTotal = hasSectionalTiming ? subjectTotalQuestions : totalQuestions;

  return (
    <View style={styles.page}>
      <View style={styles.examHeader}>
        <View style={styles.examTitleRow}>
          <Text style={styles.examTitle}>{payload.title}</Text>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push({ pathname: '/saved', params: { testid: String(testid) } })}
              style={({ pressed }) => [styles.savedChip, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="bookmark-outline" size={13} color="#D97706" />
              <Text style={styles.savedChipText}>Saved {Object.keys(savedForReview).length}</Text>
            </Pressable>
            <View style={styles.timerChip}><MaterialCommunityIcons name="clock-outline" size={13} color="#2563EB" /><Text style={styles.timerText}>{timerText}</Text></View>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subjectTabs}>
          {subjects.map((s, idx) => {
            const locked = hasSectionalTiming && (idx > maxUnlockedSubjectIndex || idx < subjectIndex);
            return (
              <Pressable key={s} onPress={() => onChangeSubject(idx)} style={[styles.subTab, idx === subjectIndex && styles.subTabActive, locked && styles.subTabLocked]}>
                <Text style={[styles.subTabText, idx === subjectIndex && styles.subTabTextActive, locked && styles.subTabTextLocked]}>{s}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.bodyContent}>
        <View style={styles.questionCard}>
          <View style={styles.questionMeta}>
            <Pressable onPress={() => setShowPalette(true)}><Text style={styles.qNumber}>Question <Text style={styles.qNumberStrong}>{questionDisplayNumber}</Text> of {questionDisplayTotal}</Text></Pressable>
            <View style={styles.qMarks}>
              <Text style={[styles.markChip, styles.positive]}>+{sectionBySubject[currentSubject]?.marksPerQuestion ?? 1} Mark</Text>
              <Text style={[styles.markChip, styles.negative]}>-{sectionBySubject[currentSubject]?.negativeMarking ?? 0.25} Mark</Text>
            </View>
          </View>

          {currentQuestion.direction ? (
            <View style={styles.directionCard}>
              <Text style={styles.directionLabel}>{currentQuestion.direction.setType ? currentQuestion.direction.setType.replaceAll('_', ' ') : 'Direction'}</Text>
              <Text style={styles.directionText}>{currentQuestion.direction.directionText}</Text>
              <InlineImage uri={directionImageUrl} style={styles.directionImage} />
            </View>
          ) : null}

          <Text style={styles.questionText}>{currentQuestion.question}</Text>
          <InlineImage uri={questionImageUrl} style={styles.questionImage} />

          <View style={styles.qActions}>
            <Pressable
              onPress={() => setSavedForReview((prev) => ({ ...prev, [answerKey]: prev[answerKey] ? undefined as never : true }))}
              style={[styles.actionBtn, styles.reviewBtn, savedForReview[answerKey] && styles.reviewBtnActive]}>
              <MaterialCommunityIcons name={savedForReview[answerKey] ? 'bookmark' : 'bookmark-outline'} size={14} color={savedForReview[answerKey] ? '#fff' : '#D97706'} />
              <Text style={[styles.actionText, { color: savedForReview[answerKey] ? '#fff' : '#D97706' }]}>{savedForReview[answerKey] ? 'Saved' : 'Save'}</Text>
            </Pressable>
          </View>

          <View style={styles.optionsList}>
            {currentQuestion.options.map((opt) => {
              const isSelected = selected === opt.id;
              return (
                <Pressable key={opt.id} onPress={() => setAnswers((prev) => ({ ...prev, [answerKey]: opt.id as OptionKey }))} style={[styles.optionItem, isSelected && styles.optionSelected]}>
                  <View style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}><Text style={[styles.optionLabelText, isSelected && styles.optionLabelTextSelected]}>{opt.id}</Text></View>
                  <View style={styles.optionBody}>
                    <Text style={styles.optionText}>{opt.text}</Text>
                    <InlineImage uri={getImageUrl(opt.image, opt.imageUrl)} style={styles.optionImage} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={styles.bottomDock}>
        <Pressable onPress={onPrev} disabled={isFirstNavigableQuestion} style={[styles.navBtn, styles.prevBtn, isFirstNavigableQuestion && styles.navDisabled]}><MaterialCommunityIcons name="chevron-left" size={14} color="#fff" /><Text style={styles.navText}>PREV</Text></Pressable>
        <Pressable onPress={() => setShowPalette(true)}><Text style={styles.counter}>Q{questionDisplayNumber}/{questionDisplayTotal}</Text></Pressable>
        <Pressable onPress={isFinalQuestion ? startSubmitFlow : onNext} style={[styles.navBtn, styles.nextBtn]}>
          <Text style={styles.navText}>{isFinalQuestion ? 'SUBMIT' : isLastQuestionInSubject && subjectIndex < subjects.length - 1 ? 'NEXT SUBJECT' : 'NEXT'}</Text>
          <MaterialCommunityIcons name={isFinalQuestion ? 'check-circle-outline' : 'chevron-right'} size={14} color="#fff" />
        </Pressable>
      </View>

      <Modal transparent visible={showPalette} animationType="fade" onRequestClose={() => setShowPalette(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}><Text style={styles.modalTitle}>{currentSubject} Questions</Text><Pressable onPress={() => setShowPalette(false)}><MaterialCommunityIcons name="close" size={18} color="#64748B" /></Pressable></View>
            {hasSectionalTiming ? (
              <Text style={styles.modalHint}>This test locks section switching. Finish this section or use Next Subject to continue.</Text>
            ) : null}
            <ScrollView style={styles.paletteScroll} contentContainerStyle={styles.paletteGrid} showsVerticalScrollIndicator={false}>
              {currentQuestions.map((question, idx) => {
                const answered = Boolean(answers[question.answerKey]);
                const isCurrent = idx === currentQuestionIndex;
                return (
                  <Pressable key={question.answerKey} onPress={() => jumpToQuestion(idx)} style={[styles.paletteCell, answered && styles.paletteAnswered, !answered && styles.paletteSkipped, isCurrent && styles.paletteCurrent]}>
                    <Text style={[styles.paletteText, answered && styles.paletteTextAnswered]}>{idx + 1}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.modalActionRow}>
              {!isFinalQuestion && subjectIndex < subjects.length - 1 ? (
                <Pressable onPress={moveToNextSubject} style={({ pressed }) => [styles.modalSecondaryAction, pressed && styles.pressed]}>
                  <Text style={styles.modalSecondaryActionText}>Next Subject</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={startSubmitFlow}
                style={({ pressed }) => [
                  styles.modalSubmit,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.modalSubmitText}>Submit Test</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={showSubmitFlow} animationType="fade" onRequestClose={() => setShowSubmitFlow(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.submitFlowCard}>
            {submitStage === 'confirm' ? (
              <>
                <Text style={styles.submitFlowTitle}>Confirm Submit</Text>
                <Text style={styles.submitFlowText}>Are you sure you want to submit this test?</Text>
                <View style={styles.submitFlowActions}>
                  <Pressable onPress={() => setShowSubmitFlow(false)} style={[styles.flowBtn, styles.flowCancel]}><Text style={styles.flowCancelText}>Cancel</Text></Pressable>
                  <Pressable onPress={confirmAndSubmit} style={[styles.flowBtn, styles.flowSubmit]}><Text style={styles.flowSubmitText}>Submit</Text></Pressable>
                </View>
              </>
            ) : (
              <>
                <Image source={require('@/assets/images/checking.png')} style={styles.submitFlowImage} resizeMode="contain" />
                <Text style={styles.submitFlowTitle}>Submitting Test...</Text>
                <Text style={styles.submitFlowText}>Packing responses and saving result.</Text>
              </>
            )}
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#EAF3FF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  centerText: { fontSize: 14, color: '#64748B', fontWeight: '600' },
  examHeader: { backgroundColor: '#fff', paddingTop: 14, paddingHorizontal: 16, paddingBottom: 0 },
  examTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 },
  examTitle: { flex: 1, fontSize: 15, fontWeight: '900', color: '#1E293B' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  savedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#FCD34D', backgroundColor: '#FFFBEB', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4 },
  savedChipText: { fontSize: 12, fontWeight: '800', color: '#D97706' },
  timerChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4 },
  timerText: { fontSize: 12, fontWeight: '800', color: '#2563EB' },
  subjectTabs: { borderBottomWidth: 2, borderBottomColor: '#E2E8F0' },
  subTab: { paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 3, borderBottomColor: 'transparent', marginBottom: -2 },
  subTabActive: { borderBottomColor: '#FF6B2C' },
  subTabLocked: { opacity: 0.45 },
  subTabText: { fontSize: 13, fontWeight: '700', color: '#64748B' },
  subTabTextActive: { color: '#FF6B2C' },
  subTabTextLocked: { color: '#94A3B8' },
  bodyContent: { paddingBottom: 92 },
  questionCard: { backgroundColor: '#fff', padding: 16, minHeight: 420 },
  questionMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  qNumber: { fontSize: 13, color: '#64748B', fontWeight: '700' },
  qNumberStrong: { fontWeight: '900', color: '#1E293B' },
  qMarks: { flexDirection: 'row', gap: 8 },
  markChip: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, overflow: 'hidden' },
  positive: { backgroundColor: '#DCFCE7', color: '#16A34A' },
  negative: { backgroundColor: '#FEE2E2', color: '#DC2626' },
  directionCard: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#DBEAFE', borderRadius: 12, padding: 12, marginBottom: 14 },
  directionLabel: { fontSize: 11, fontWeight: '900', color: '#2563EB', textTransform: 'uppercase', marginBottom: 6 },
  directionText: { fontSize: 14, fontWeight: '600', color: '#334155', lineHeight: 21 },
  directionImage: { width: '100%', height: 180, marginTop: 10, borderRadius: 10, backgroundColor: '#E2E8F0' },
  questionText: { fontSize: 15, fontWeight: '700', color: '#1E293B', lineHeight: 22, marginBottom: 16 },
  questionImage: { width: '100%', height: 220, marginBottom: 16, borderRadius: 10, backgroundColor: '#E2E8F0' },
  qActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1.5 },
  reviewBtn: { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' },
  reviewBtnActive: { backgroundColor: '#D97706', borderColor: '#D97706' },
  actionText: { fontSize: 12, fontWeight: '800' },
  optionsList: { gap: 10, marginBottom: 18 },
  optionItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 10, borderWidth: 2, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  optionSelected: { borderColor: '#FF6B2C', backgroundColor: '#FFF7F3' },
  optionLabel: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#E2E8F0', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  optionLabelSelected: { backgroundColor: '#FF6B2C', borderColor: '#FF6B2C' },
  optionLabelText: { fontSize: 13, fontWeight: '900', color: '#64748B' },
  optionLabelTextSelected: { color: '#fff' },
  optionBody: { flex: 1, gap: 8 },
  optionText: { fontSize: 15, fontWeight: '700', color: '#1E293B' },
  optionImage: { width: '100%', height: 180, borderRadius: 10, backgroundColor: '#E2E8F0' },
  submitBtn: { backgroundColor: '#FF6B2C', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: 0.3 },
  bottomDock: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 14 },
  prevBtn: { backgroundColor: '#FF6B2C' },
  nextBtn: { backgroundColor: '#2563EB' },
  navDisabled: { opacity: 0.45 },
  navText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  counter: { fontSize: 14, fontWeight: '800', color: '#1E293B' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 430, backgroundColor: '#fff', borderRadius: 16, padding: 14 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  modalTitle: { fontSize: 14, fontWeight: '900', color: '#1E293B' },
  modalHint: { fontSize: 12, lineHeight: 18, fontWeight: '600', color: '#475569', marginBottom: 12 },
  paletteScroll: { maxHeight: 320 },
  paletteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  paletteCell: { width: 38, height: 38, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  paletteAnswered: { backgroundColor: '#22C55E', borderColor: '#22C55E' },
  paletteSkipped: { backgroundColor: '#fff', borderColor: '#E2E8F0' },
  paletteCurrent: { borderColor: '#2563EB', borderWidth: 2 },
  paletteText: { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  paletteTextAnswered: { color: '#fff' },
  modalActionRow: { flexDirection: 'row', gap: 10 },
  modalSecondaryAction: { flex: 1, backgroundColor: '#EFF6FF', borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#BFDBFE' },
  modalSecondaryActionText: { color: '#2563EB', fontSize: 14, fontWeight: '900' },
  modalSubmit: { flex: 1, backgroundColor: '#FF6B2C', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  modalSubmitText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  submitFlowCard: { width: '100%', maxWidth: 360, backgroundColor: '#fff', borderRadius: 16, padding: 18, alignItems: 'center', gap: 10 },
  submitFlowImage: { width: 110, height: 110 },
  submitFlowTitle: { fontSize: 18, fontWeight: '900', color: '#1E293B', textAlign: 'center' },
  submitFlowText: { fontSize: 13, fontWeight: '600', color: '#64748B', textAlign: 'center' },
  submitFlowActions: { marginTop: 8, width: '100%', flexDirection: 'row', gap: 8 },
  flowBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  flowCancel: { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  flowSubmit: { backgroundColor: '#FF6B2C' },
  flowCancelText: { fontSize: 14, fontWeight: '800', color: '#475569' },
  flowSubmitText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  pressed: { opacity: 0.85 },
});

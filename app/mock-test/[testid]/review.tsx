import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import ExamMathRenderer from '@/components/math/MathRenderer';
import { flattenSectionQuestions, getImageUrl, normalizeSubject, shouldDisableMathForSection, type FlattenedLiveQuestion, type LiveMockPayload, type LiveOption } from '@/constants/mock-live-types';
import { getCachedMockTestById, getCachedSession } from '@/lib/app-data-cache';
import { getLocalMockAttemptById } from '@/lib/local-mock-data';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────
type Tab = 'review' | 'score' | 'leaderboard';

type LeaderboardRow = {
  id: string;
  user_name: string;
  score: number;
  rank: number;
  avatar_url?: string | null;
};

type AttemptData = {
  score_total: number;
  attempted_total: number;
  total_questions: number;
  answers: Record<string, string>;
  subject_scores: {
    subject: string;
    correct: number;
    attempted: number;
    total: number;
    score?: number;
  }[];
};

type ReviewRow = {
  id: string;
  user_id: string;
  rating: number;
  review_text: string | null;
  recommended: boolean;
  created_at: string;
};

function InlineImage({ uri, style }: { uri?: string | null; style: object }) {
  if (!uri) return null;
  return <Image source={{ uri }} style={style} resizeMode="contain" />;
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
function getResultColor(status: 'correct' | 'wrong' | 'skipped') {
  if (status === 'correct') return '#16A34A';
  if (status === 'wrong') return '#DC2626';
  return '#94A3B8';
}

function getResultBg(status: 'correct' | 'wrong' | 'skipped') {
  if (status === 'correct') return '#F0FDF4';
  if (status === 'wrong') return '#FEF2F2';
  return '#F8FAFC';
}

function getResultBorder(status: 'correct' | 'wrong' | 'skipped') {
  if (status === 'correct') return '#86EFAC';
  if (status === 'wrong') return '#FCA5A5';
  return '#E2E8F0';
}

function getDifficultyColor(d?: string) {
  if (d === 'Easy') return { bg: '#DCFCE7', text: '#16A34A' };
  if (d === 'Medium') return { bg: '#FEF3C7', text: '#D97706' };
  if (d === 'Hard') return { bg: '#FEE2E2', text: '#DC2626' };
  return { bg: '#F1F5F9', text: '#64748B' };
}

// ─────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────

function ProgressRing({ pct, size = 72, stroke = 7, color = '#2563EB' }: { pct: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* SVG-like with border trick for RN */}
      <View style={{
        width: size, height: size, borderRadius: size / 2,
        borderWidth: stroke, borderColor: '#E2E8F0',
        alignItems: 'center', justifyContent: 'center', position: 'absolute',
      }} />
      {/* Filled arc – approximate with colored border on one side */}
      <View style={{
        width: size, height: size, borderRadius: size / 2,
        borderWidth: stroke,
        borderTopColor: pct >= 25 ? color : 'transparent',
        borderRightColor: pct >= 50 ? color : 'transparent',
        borderBottomColor: pct >= 75 ? color : 'transparent',
        borderLeftColor: pct >= 100 ? color : 'transparent',
        transform: [{ rotate: '-90deg' }],
        position: 'absolute',
      }} />
    </View>
  );
}

function ScorePill({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <View style={[scorePillStyle.wrap, { borderColor: accent + '33' }]}>
      <Text style={[scorePillStyle.val, { color: accent }]}>{value}</Text>
      <Text style={scorePillStyle.lbl}>{label}</Text>
    </View>
  );
}

const scorePillStyle = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, backgroundColor: '#FAFCFF' },
  val: { fontSize: 20, fontWeight: '900' },
  lbl: { marginTop: 2, fontSize: 10, fontWeight: '700', color: '#64748B' },
});

function formatSignedScore(score: number) {
  if (score > 0) return `+${score}`;
  return `${score}`;
}

function SectionScoreBar({
  name,
  correct,
  attempted,
  total,
  score,
}: {
  name: string;
  correct: number;
  attempted: number;
  total: number;
  score: number;
}) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const wrong = Math.max(0, attempted - correct);
  const skipped = Math.max(0, total - attempted);
  const scoreColor = score > 0 ? '#16A34A' : score < 0 ? '#DC2626' : '#64748B';

  return (
    <View style={s.sectionBreakdownCard}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#334155' }}>{name}</Text>
        <Text style={{ fontSize: 13, fontWeight: '900', color: scoreColor }}>{formatSignedScore(score)}</Text>
      </View>
      <View style={{ height: 7, backgroundColor: '#E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
        <View style={{
          height: '100%', width: `${pct}%`, borderRadius: 10,
          backgroundColor: pct >= 70 ? '#22C55E' : pct >= 40 ? '#F59E0B' : '#EF4444',
        }} />
      </View>
      <View style={s.sectionBreakdownMeta}>
        <Text style={s.sectionBreakdownMetaText}>Correct {correct}</Text>
        <Text style={s.sectionBreakdownMetaText}>Wrong {wrong}</Text>
        <Text style={s.sectionBreakdownMetaText}>Skipped {skipped}</Text>
        <Text style={s.sectionBreakdownMetaText}>Attempted {attempted}/{total}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────
export default function MockTestReviewPage() {
  const params = useLocalSearchParams<{ testid: string; attemptId?: string; localAttemptId?: string }>();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('review');
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [attempt, setAttempt] = useState<AttemptData | null>(null);
  const [payload, setPayload] = useState<LiveMockPayload | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [isLocalAttempt, setIsLocalAttempt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Question-by-question review state
  const [flatQuestions, setFlatQuestions] = useState<FlattenedLiveQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showExplanation, setShowExplanation] = useState(true);

  // User rating/review
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [myRating, setMyRating] = useState(5);
  const [myReviewText, setMyReviewText] = useState('');
  const [myRecommended, setMyRecommended] = useState(true);
  const [savingReview, setSavingReview] = useState(false);

  // Slide animation
  const slideAnim = useRef(new Animated.Value(0)).current;
  const reviewScrollRef = useRef<ScrollView | null>(null);

  // ── Load data ──────────────────────────────────────────
  const load = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const testId = String(params.testid);
      const [session, cachedPayload] = await Promise.all([
        getCachedSession(),
        getCachedMockTestById(testId),
      ]);

      const uid = session?.user?.id ?? null;
      setSessionUserId(uid);

      setPayload(cachedPayload ? (cachedPayload as LiveMockPayload) : null);

      if (params.localAttemptId) {
        const localAttempt = await getLocalMockAttemptById(String(params.localAttemptId));
        setIsLocalAttempt(true);
        setAttempt(localAttempt ? {
          score_total: Number(localAttempt.score_total ?? 0),
          attempted_total: Number(localAttempt.attempted_total ?? 0),
          total_questions: Number(localAttempt.total_questions ?? 0),
          answers: (localAttempt.answers ?? {}) as Record<string, string>,
          subject_scores: (localAttempt.subject_scores ?? []) as AttemptData['subject_scores'],
        } : null);
      } else {
        setIsLocalAttempt(false);
        setAttempt(null);
      }

      if (supabase && hasSupabaseConfig) {
        const [lbRes, attemptRes, reviewsRes] = await Promise.all([
          supabase.from('mock_test_leaderboard')
            .select('id,user_name,score,rank,test_id,avatar_url')
            .eq('test_id', testId)
            .order('rank', { ascending: true })
            .limit(50),
          params.attemptId
            ? supabase.from('mock_test_attempts')
                .select('score_total,attempted_total,total_questions,answers,subject_scores')
                .eq('id', params.attemptId)
                .single()
            : Promise.resolve({ data: null, error: null }),
          supabase.from('mock_test_reviews')
            .select('id,user_id,rating,review_text,recommended,created_at')
            .eq('test_id', testId)
            .order('created_at', { ascending: false })
            .limit(50),
        ]);

        if (!lbRes.error && lbRes.data) {
          setLeaderboard(lbRes.data.map((row) => ({
            id: String(row.id),
            user_name: String(row.user_name ?? 'User'),
            score: Number(row.score ?? 0),
            rank: Number(row.rank ?? 0),
            avatar_url: (row.avatar_url as string | null) ?? null,
          })));
        } else {
          setLeaderboard([]);
        }

        if (!params.localAttemptId && !attemptRes.error && attemptRes.data) {
          setAttempt({
            score_total: Number(attemptRes.data.score_total ?? 0),
            attempted_total: Number(attemptRes.data.attempted_total ?? 0),
            total_questions: Number(attemptRes.data.total_questions ?? 0),
            answers: (attemptRes.data.answers ?? {}) as Record<string, string>,
            subject_scores: (attemptRes.data.subject_scores ?? []) as AttemptData['subject_scores'],
          });
        }

        if (!reviewsRes.error && reviewsRes.data) {
          const mapped = reviewsRes.data.map((r) => ({
            id: String(r.id),
            user_id: String(r.user_id),
            rating: Number(r.rating ?? 5),
            review_text: (r.review_text as string | null) ?? null,
            recommended: Boolean(r.recommended),
            created_at: String(r.created_at),
          }));
          setReviews(mapped);
          if (uid) {
            const mine = mapped.find((r) => r.user_id === uid);
            if (mine) {
              setMyRating(mine.rating);
              setMyReviewText(mine.review_text ?? '');
              setMyRecommended(mine.recommended);
            }
          }
        } else {
          setReviews([]);
        }
        return;
      }

      setLeaderboard([]);
      setReviews([]);
    } catch (error) {
      console.error('Failed to load mock test review', error);
      setLoadError(error instanceof Error ? error.message : 'Failed to load review.');
      setLeaderboard([]);
      setReviews([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [params.testid, params.attemptId, params.localAttemptId]);

  // ── Flatten questions ──────────────────────────────────
  useEffect(() => {
    if (!payload) return;
    const flat: FlattenedLiveQuestion[] = [];
    let globalIdx = 0;
    for (const section of payload.sections ?? []) {
      const nextQuestions = flattenSectionQuestions(section, globalIdx);
      flat.push(...nextQuestions);
      globalIdx += nextQuestions.length;
    }
    setFlatQuestions(flat);
  }, [payload]);

  // ── Derived values ─────────────────────────────────────
  const totalCorrect = attempt?.subject_scores?.reduce((s, r) => s + Number(r.correct ?? 0), 0) ?? 0;
  const accuracy = attempt && attempt.attempted_total > 0
    ? Math.round((totalCorrect / attempt.attempted_total) * 100) : 0;
  const totalMarks = Number(payload?.totalMarks ?? attempt?.total_questions ?? 0);

  const avgRating = useMemo(() => {
    if (!reviews.length) return 0;
    return Number((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1));
  }, [reviews]);

  // Current question data
  const currentQ = flatQuestions[currentIdx] ?? null;
  const disableMath = shouldDisableMathForSection(currentQ?.sectionName);
  const userAnswer = currentQ ? (attempt?.answers?.[currentQ.answerKey] ?? null) : null;
  const questionStatus: 'correct' | 'wrong' | 'skipped' = !userAnswer
    ? 'skipped'
    : userAnswer === currentQ?.correctAnswer
    ? 'correct'
    : 'wrong';

  // ── Navigation ─────────────────────────────────────────
  const animateAndNavigate = (dir: 1 | -1) => {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: dir * -30, duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]).start();
    setCurrentIdx((i) => Math.max(0, Math.min(flatQuestions.length - 1, i + dir)));
    requestAnimationFrame(() => {
      reviewScrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  };

  // ── Save review ────────────────────────────────────────
  const saveReview = async () => {
    if (!supabase || !sessionUserId) {
      Alert.alert('Login required', 'Please log in to submit a review.');
      return;
    }
    setSavingReview(true);
    try {
      const { error } = await supabase.from('mock_test_reviews').upsert(
        {
          test_id: String(params.testid),
          user_id: sessionUserId,
          rating: myRating,
          review_text: myReviewText.trim() || null,
          recommended: myRecommended,
        },
        { onConflict: 'test_id,user_id' }
      );
      if (error) throw error;
      Alert.alert('Saved ✓', 'Your review has been submitted.');
      await load();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save review.');
    } finally {
      setSavingReview(false);
    }
  };

  // ── Render: REVIEW TAB ─────────────────────────────────
  const renderReviewTab = () => {
    if (loading) {
      return (
        <View style={s.emptyWrap}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={s.emptyText}>Loading review...</Text>
        </View>
      );
    }

    if (!currentQ) {
      return (
        <View style={s.emptyWrap}>
          <MaterialCommunityIcons name={loadError ? 'alert-circle-outline' : 'book-open-variant'} size={48} color="#CBD5E1" />
          <Text style={s.emptyText}>{loadError ?? 'No questions to review'}</Text>
        </View>
      );
    }

    const diff = getDifficultyColor(currentQ.difficulty);
    const isCorrect = questionStatus === 'correct';
    const isWrong = questionStatus === 'wrong';
    const isSkipped = questionStatus === 'skipped';
    const directionImageUrl = currentQ.direction?.imageUrl ?? null;
    const questionImageUrl = getImageUrl(currentQ.image, currentQ.imageUrl);

    return (
      <ScrollView ref={reviewScrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Result Banner */}
        <View style={[s.resultBanner, {
          backgroundColor: getResultBg(questionStatus),
          borderColor: getResultBorder(questionStatus),
        }]}>
          <MaterialCommunityIcons
            name={isCorrect ? 'check-circle' : isWrong ? 'close-circle' : 'minus-circle'}
            size={20}
            color={getResultColor(questionStatus)}
          />
          <Text style={[s.resultBannerText, { color: getResultColor(questionStatus) }]}>
            {isCorrect ? 'Correct! Well done.' : isWrong ? 'Incorrect answer.' : 'Question skipped.'}
          </Text>
          {isCorrect && (
            <View style={s.markBadge}>
              <Text style={s.markBadgeText}>+{payload?.sections?.[0]?.marksPerQuestion ?? 1}</Text>
            </View>
          )}
          {isWrong && (
            <View style={[s.markBadge, { backgroundColor: '#FEE2E2' }]}>
              <Text style={[s.markBadgeText, { color: '#DC2626' }]}>
                -{payload?.sections?.find(s => normalizeSubject(s.name) === currentQ.sectionName)?.negativeMarking ?? 0.25}
              </Text>
            </View>
          )}
        </View>

        {/* Question Card */}
        <Animated.View style={[s.questionCard, { transform: [{ translateX: slideAnim }] }]}>

          {/* Header row */}
          <View style={s.qHeaderRow}>
            <View style={s.sectionTag}>
              <Text style={s.sectionTagText}>{currentQ.sectionName}</Text>
            </View>
            <View style={[s.diffTag, { backgroundColor: diff.bg }]}>
              <Text style={[s.diffTagText, { color: diff.text }]}>{currentQ.difficulty ?? 'Medium'}</Text>
            </View>
            <Text style={s.qCounter}>
              {currentIdx + 1}/{flatQuestions.length}
            </Text>
          </View>

          {/* Mark chips */}
          <View style={s.markRow}>
            <View style={s.markChip}>
              <Text style={s.markChipPos}>+{payload?.sections?.find(s => normalizeSubject(s.name) === currentQ.sectionName)?.marksPerQuestion ?? 1} Mark</Text>
            </View>
            <View style={[s.markChip, { backgroundColor: '#FEE2E2' }]}>
              <Text style={[s.markChipPos, { color: '#DC2626' }]}>
                -{payload?.sections?.find(s => normalizeSubject(s.name) === currentQ.sectionName)?.negativeMarking ?? 0.25} Mark
              </Text>
            </View>
          </View>

          {currentQ.direction ? (
            <View style={s.directionCard}>
              <Text style={s.directionLabel}>{currentQ.direction.setType ? currentQ.direction.setType.replaceAll('_', ' ') : 'Direction'}</Text>
              <ExamMathRenderer content={currentQ.direction.directionText} textStyle={s.directionText} disableMath={disableMath} />
              <InlineImage uri={directionImageUrl} style={s.directionImage} />
            </View>
          ) : null}

          {/* Question text */}
          <ExamMathRenderer content={currentQ.question} textStyle={s.qText} disableMath={disableMath} />
          <InlineImage uri={questionImageUrl} style={s.questionImage} />

          {/* Options */}
          <View style={s.optionsList}>
            {currentQ.options.map((opt: LiveOption) => {
              const isCorrectOpt = opt.id === currentQ.correctAnswer;
              const isUserOpt = opt.id === userAnswer;
              const isWrongUserOpt = isUserOpt && !isCorrectOpt;

              let optBg = '#F8FAFC';
              let optBorder = '#E2E8F0';
              let labelBg = '#FFFFFF';
              let labelBorder = '#E2E8F0';
              let labelColor = '#64748B';
              let textColor = '#334155';

              if (isCorrectOpt) {
                optBg = '#F0FDF4'; optBorder = '#86EFAC';
                labelBg = '#22C55E'; labelBorder = '#22C55E'; labelColor = '#FFF'; textColor = '#15803D';
              } else if (isWrongUserOpt) {
                optBg = '#FEF2F2'; optBorder = '#FCA5A5';
                labelBg = '#EF4444'; labelBorder = '#EF4444'; labelColor = '#FFF'; textColor = '#B91C1C';
              }

              return (
                <View key={opt.id} style={[s.optionItem, { backgroundColor: optBg, borderColor: optBorder }]}>
                  <View style={[s.optionLabel, { backgroundColor: labelBg, borderColor: labelBorder }]}>
                    <Text style={[s.optionLabelText, { color: labelColor }]}>{opt.id}</Text>
                  </View>
                  <View style={s.optionBody}>
                    <ExamMathRenderer content={opt.text} textStyle={[s.optionText, { color: textColor }]} disableMath={disableMath} />
                    <InlineImage uri={getImageUrl(opt.image, opt.imageUrl)} style={s.optionImage} />
                  </View>
                  {isCorrectOpt && (
                    <MaterialCommunityIcons name="check-circle" size={18} color="#22C55E" />
                  )}
                  {isWrongUserOpt && (
                    <MaterialCommunityIcons name="close-circle" size={18} color="#EF4444" />
                  )}
                  {isUserOpt && isCorrectOpt && (
                    <View style={s.yourAnswerTag}>
                      <Text style={s.yourAnswerTagText}>Your answer</Text>
                    </View>
                  )}
                  {isWrongUserOpt && (
                    <View style={[s.yourAnswerTag, { backgroundColor: '#FEE2E2' }]}>
                      <Text style={[s.yourAnswerTagText, { color: '#DC2626' }]}>Your answer</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Correct answer summary (if skipped or wrong) */}
          {!isCorrect && (
            <View style={s.correctAnswerBox}>
              <MaterialCommunityIcons name="lightbulb-on" size={16} color="#D97706" />
              <View style={s.correctAnswerText}>
                <Text style={s.correctAnswerLabel}>Correct Answer:</Text>
                <Text style={s.correctAnswerLine}>
                  {currentQ.correctAnswer} — {currentQ.options.find((o: LiveOption) => o.id === currentQ.correctAnswer)?.text}
                </Text>
              </View>
            </View>
          )}

          {/* Explanation toggle */}
          <Pressable
            style={[s.explainToggle, showExplanation && { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}
            onPress={() => setShowExplanation(v => !v)}
          >
            <MaterialCommunityIcons
              name={showExplanation ? 'chevron-up' : 'book-open-outline'}
              size={18}
              color="#2563EB"
            />
            <Text style={s.explainToggleText}>
              {showExplanation ? 'Hide Explanation' : 'Show Full Explanation'}
            </Text>
          </Pressable>

          {/* Explanation block */}
          {showExplanation && (
            <View style={s.explainBlock}>

              {/* Step-by-step explanation */}
              <View style={s.explainSection}>
                <View style={s.explainSectionHeader}>
                  <MaterialCommunityIcons name="text-box-outline" size={15} color="#2563EB" />
                  <Text style={s.explainSectionTitle}>Explanation</Text>
                </View>
                <ExamMathRenderer content={currentQ.explanation ?? 'No explanation provided for this question.'} textStyle={s.explainBody} disableMath={disableMath} />
              </View>

              {/* Key points per option */}
              {(currentQ.keyPoints ?? []).length > 0 && (
                <View style={s.explainSection}>
                  <View style={s.explainSectionHeader}>
                    <MaterialCommunityIcons name="format-list-bulleted" size={15} color="#7C3AED" />
                    <Text style={[s.explainSectionTitle, { color: '#7C3AED' }]}>Key Points</Text>
                  </View>
                  {(currentQ.keyPoints ?? []).map((kp: { option: string; explanation: string }) => {
                    const isKpCorrect = kp.option === currentQ.correctAnswer;
                    return (
                      <View
                        key={kp.option}
                        style={[s.keyPointRow, {
                          backgroundColor: isKpCorrect ? '#F0FDF4' : '#F8FAFC',
                          borderLeftColor: isKpCorrect ? '#22C55E' : '#CBD5E1',
                        }]}
                      >
                        <View style={[s.kpOptionBadge, {
                          backgroundColor: isKpCorrect ? '#22C55E' : '#E2E8F0',
                        }]}>
                          <Text style={[s.kpOptionBadgeText, { color: isKpCorrect ? '#FFF' : '#64748B' }]}>
                            {kp.option}
                          </Text>
                        </View>
                        <ExamMathRenderer content={kp.explanation} textStyle={[s.kpText, isKpCorrect && { color: '#15803D' }]} disableMath={disableMath} />
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Exam insight */}
              {currentQ.examInsight ? (
                <View style={[s.explainSection, s.insightBox]}>
                  <View style={s.explainSectionHeader}>
                    <MaterialCommunityIcons name="school-outline" size={15} color="#0369A1" />
                    <Text style={[s.explainSectionTitle, { color: '#0369A1' }]}>Exam Insight</Text>
                  </View>
                  <ExamMathRenderer content={currentQ.examInsight} textStyle={[s.explainBody, { color: '#0C4A6E' }]} disableMath={disableMath} />
                </View>
              ) : null}

              {/* Common trap */}
              {currentQ.commonTrap ? (
                <View style={[s.explainSection, s.trapBox]}>
                  <View style={s.explainSectionHeader}>
                    <MaterialCommunityIcons name="alert-outline" size={15} color="#B45309" />
                    <Text style={[s.explainSectionTitle, { color: '#B45309' }]}>Common Trap</Text>
                  </View>
                  <ExamMathRenderer content={currentQ.commonTrap} textStyle={[s.explainBody, { color: '#92400E' }]} disableMath={disableMath} />
                </View>
              ) : null}

              {/* Memory trick */}
              {currentQ.memoryTrick ? (
                <View style={[s.explainSection, s.trickBox]}>
                  <View style={s.explainSectionHeader}>
                    <MaterialCommunityIcons name="brain" size={15} color="#7C3AED" />
                    <Text style={[s.explainSectionTitle, { color: '#7C3AED' }]}>Memory Trick</Text>
                  </View>
                  <View style={s.memoryTrickRow}>
                    <Text style={s.memoryTrickIcon}>Lightbulb: </Text>
                    <View style={s.memoryTrickBody}>
                      <ExamMathRenderer content={currentQ.memoryTrick} textStyle={[s.explainBody, { color: '#5B21B6', fontStyle: 'italic' }]} disableMath={disableMath} />
                    </View>
                  </View>
                </View>
              ) : null}

            </View>
          )}
        </Animated.View>

        {/* Navigation */}
        <View style={s.navRow}>
          <Pressable
            style={[s.navBtn, s.navBtnPrev, currentIdx === 0 && s.navBtnDisabled]}
            onPress={() => currentIdx > 0 && animateAndNavigate(-1)}
            disabled={currentIdx === 0}
          >
            <MaterialCommunityIcons name="chevron-left" size={18} color={currentIdx === 0 ? '#CBD5E1' : '#FFF'} />
            <Text style={[s.navBtnText, currentIdx === 0 && { color: '#CBD5E1' }]}>PREV</Text>
          </Pressable>

          <View style={s.navCenter}>
            <Text style={s.navCenterText}>Q{currentIdx + 1}/{flatQuestions.length}</Text>
            <Text style={s.navCenterSub}>{currentQ.sectionName}</Text>
          </View>

          <Pressable
            style={[s.navBtn, s.navBtnNext, currentIdx === flatQuestions.length - 1 && s.navBtnDisabled]}
            onPress={() => currentIdx < flatQuestions.length - 1 && animateAndNavigate(1)}
            disabled={currentIdx === flatQuestions.length - 1}
          >
            <Text style={[s.navBtnText, currentIdx === flatQuestions.length - 1 && { color: '#CBD5E1' }]}>NEXT</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={currentIdx === flatQuestions.length - 1 ? '#CBD5E1' : '#FFF'} />
          </Pressable>
        </View>

        {/* Question progress dots */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.dotRow}
          style={{ marginTop: 12 }}
        >
          {flatQuestions.map((q, i) => {
            const ua = attempt?.answers?.[q.answerKey];
            const dotStatus = !ua ? 'skipped' : ua === q.correctAnswer ? 'correct' : 'wrong';
            return (
              <Pressable
                key={q.answerKey}
                onPress={() => {
                  setCurrentIdx(i);
                  requestAnimationFrame(() => {
                    reviewScrollRef.current?.scrollTo({ y: 0, animated: true });
                  });
                }}
                style={[s.dot, {
                  backgroundColor: i === currentIdx
                    ? '#2563EB'
                    : dotStatus === 'correct' ? '#22C55E'
                    : dotStatus === 'wrong' ? '#EF4444'
                    : '#E2E8F0',
                  transform: [{ scale: i === currentIdx ? 1.2 : 1 }],
                }]}
              />
            );
          })}
        </ScrollView>

        {/* Dot legend */}
        <View style={s.dotLegend}>
          {[
            { color: '#22C55E', label: 'Correct' },
            { color: '#EF4444', label: 'Wrong' },
            { color: '#E2E8F0', label: 'Skipped' },
            { color: '#2563EB', label: 'Current' },
          ].map(item => (
            <View key={item.label} style={s.dotLegendItem}>
              <View style={[s.dotLegendDot, { backgroundColor: item.color }]} />
              <Text style={s.dotLegendText}>{item.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  };

  // ── Render: SCORE TAB ──────────────────────────────────
  const renderScoreTab = () => {
    const wrong = (attempt?.attempted_total ?? 0) - totalCorrect;
    const skipped = (attempt?.total_questions ?? 0) - (attempt?.attempted_total ?? 0);
    const scoreColor = accuracy >= 70 ? '#22C55E' : accuracy >= 40 ? '#F59E0B' : '#EF4444';

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>

        {isLocalAttempt && (
          <View style={s.localNote}>
            <MaterialCommunityIcons name="information-outline" size={14} color="#B45309" />
            <Text style={s.localNoteText}>Result saved on this device only — not synced to the cloud.</Text>
          </View>
        )}

        {/* Overall score hero */}
        <View style={s.scoreHero}>
          <View style={{ alignItems: 'center', marginBottom: 12 }}>
            <Text style={s.scoreHeroLabel}>Your Score</Text>
            <Text style={[s.scoreHeroBig, { color: scoreColor }]}>
              {attempt?.score_total ?? 0}
              <Text style={s.scoreHeroOf}>/{totalMarks}</Text>
            </Text>
            <Text style={s.scoreHeroSub}>
              {accuracy >= 70 ? '🎉 Excellent performance!' : accuracy >= 40 ? '👍 Good effort, keep going!' : '💪 Keep practising!'}
            </Text>
          </View>

          {/* Stat pills */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <ScorePill label="Correct" value={totalCorrect} accent="#22C55E" />
            <ScorePill label="Wrong" value={wrong} accent="#EF4444" />
            <ScorePill label="Skipped" value={skipped} accent="#94A3B8" />
            <ScorePill label="Accuracy" value={`${accuracy}%`} accent="#2563EB" />
          </View>
        </View>

        {/* Section breakdown */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Section Breakdown</Text>
          {(attempt?.subject_scores ?? []).map((sec) => (
            <SectionScoreBar
              key={sec.subject}
              name={sec.subject}
              correct={sec.correct}
              attempted={sec.attempted}
              total={sec.total}
              score={Number(sec.score ?? 0)}
            />
          ))}
          {(attempt?.subject_scores ?? []).length === 0 && (
            <Text style={s.emptyText}>No section data available.</Text>
          )}
        </View>

        {/* User review form */}
        {/* <View style={s.card}>
          <Text style={s.cardTitle}>Rate This Mock Test</Text>

          {avgRating > 0 && (
            <View style={s.avgRatingRow}>
              <MaterialCommunityIcons name="star" size={16} color="#F59E0B" />
              <Text style={s.avgRatingText}>{avgRating}/5 average · {reviews.length} review{reviews.length !== 1 ? 's' : ''}</Text>
            </View>
          )}

          <Text style={s.reviewSubLabel}>Your rating</Text>
          <View style={s.starsRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setMyRating(n)} style={{ padding: 4 }}>
                <MaterialCommunityIcons
                  name={n <= myRating ? 'star' : 'star-outline'}
                  size={28}
                  color="#F59E0B"
                />
              </Pressable>
            ))}
          </View>

          <TextInput
            style={s.reviewInput}
            value={myReviewText}
            onChangeText={setMyReviewText}
            placeholder="Share your thoughts about this mock test…"
            placeholderTextColor="#94A3B8"
            multiline
            numberOfLines={3}
          />

          <Pressable onPress={() => setMyRecommended(v => !v)} style={s.recommendRow}>
            <MaterialCommunityIcons
              name={myRecommended ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={20}
              color="#2563EB"
            />
            <Text style={s.recommendText}>I recommend this mock test to others</Text>
          </Pressable>

          <Pressable
            onPress={saveReview}
            disabled={savingReview}
            style={[s.saveBtn, savingReview && s.saveBtnDisabled]}
          >
            {savingReview
              ? <MaterialCommunityIcons name="loading" size={18} color="#FFF" />
              : <MaterialCommunityIcons name="send" size={16} color="#FFF" />}
            <Text style={s.saveBtnText}>{savingReview ? 'Saving…' : 'Submit Review'}</Text>
          </Pressable>
        </View> */}

        {/* Other reviews */}
        {/* {reviews.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Community Reviews</Text>
            {reviews.slice(0, 5).map((r) => (
              <View key={r.id} style={s.reviewCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <View style={s.reviewAvatar}>
                    <Text style={s.reviewAvatarText}>{r.user_id.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', gap: 2 }}>
                      {[1,2,3,4,5].map(n => (
                        <MaterialCommunityIcons key={n} name={n <= r.rating ? 'star' : 'star-outline'} size={12} color="#F59E0B" />
                      ))}
                    </View>
                    <Text style={s.reviewDate}>{new Date(r.created_at).toLocaleDateString()}</Text>
                  </View>
                  {r.recommended && (
                    <View style={s.recommendedBadge}>
                      <Text style={s.recommendedBadgeText}>Recommended</Text>
                    </View>
                  )}
                </View>
                {r.review_text ? <Text style={s.reviewText}>{r.review_text}</Text> : null}
              </View>
            ))}
          </View>
        )} */}

      </ScrollView>
    );
  };

  // ── Render: LEADERBOARD TAB ────────────────────────────
  const renderLeaderboardTab = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={s.card}>
        <Text style={s.cardTitle}>🏆 Leaderboard</Text>
        {leaderboard.length === 0 ? (
          <View style={s.emptyWrap}>
            <MaterialCommunityIcons name="trophy-outline" size={40} color="#CBD5E1" />
            <Text style={s.emptyText}>No leaderboard entries yet.</Text>
          </View>
        ) : null}
        {leaderboard.map((row, i) => {
          const isTop3 = row.rank <= 3;
          const rankColors = ['#F59E0B', '#94A3B8', '#D97706'];
          const rankColor = isTop3 ? rankColors[row.rank - 1] : '#CBD5E1';
          return (
            <View key={row.id} style={[s.lbRow, isTop3 && { backgroundColor: rankColor + '18' }]}>
              <View style={[s.lbRank, { backgroundColor: rankColor + '22' }]}>
                {isTop3
                  ? <MaterialCommunityIcons name="trophy" size={14} color={rankColor} />
                  : <Text style={[s.lbRankText, { color: rankColor }]}>{row.rank}</Text>}
              </View>
              <View style={s.lbAvatar}>
                <Text style={s.lbAvatarText}>{row.user_name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text style={[s.lbName, isTop3 && { fontWeight: '900' }]}>{row.user_name}</Text>
              <View style={s.lbScoreWrap}>
                <MaterialCommunityIcons name="star" size={13} color="#F59E0B" />
                <Text style={s.lbScoreText}>{row.score}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );

  // ── Root render ────────────────────────────────────────
  return (
    <View style={s.page}>

      {/* Page header */}
      <View style={s.pageHeader}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={20} color="#1E293B" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.pageTitle} numberOfLines={1}>
            {payload?.title ?? 'Test Review'}
          </Text>
          <Text style={s.pageSubtitle}>{payload?.exam ?? ''}</Text>
        </View>
        {/* Score badge */}
        {attempt && (
          <View style={s.headerScoreBadge}>
            <Text style={s.headerScoreText}>{attempt.score_total}/{totalMarks}</Text>
          </View>
        )}
      </View>

      {/* Tabs */}
      <View style={s.tabBar}>
        {(['review', 'score', 'leaderboard'] as Tab[]).map((t) => (
          <Pressable key={t} style={[s.tabItem, tab === t && s.tabItemActive]} onPress={() => setTab(t)}>
            <MaterialCommunityIcons
              name={t === 'review' ? 'book-open-page-variant' : t === 'score' ? 'chart-bar' : 'trophy'}
              size={15}
              color={tab === t ? '#2563EB' : '#94A3B8'}
            />
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'review' ? 'Review' : t === 'score' ? 'Score' : 'Leaderboard'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Tab content */}
      <View style={{ flex: 1, paddingHorizontal: 14, paddingTop: 12 }}>
        {tab === 'review' && renderReviewTab()}
        {tab === 'score' && renderScoreTab()}
        {tab === 'leaderboard' && renderLeaderboardTab()}
      </View>

    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#EAF3FF' },

  // Header
  pageHeader: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 3,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#F8FAFC',
    alignItems: 'center', justifyContent: 'center',
  },
  pageTitle: { fontSize: 16, fontWeight: '900', color: '#1E293B' },
  pageSubtitle: { fontSize: 11, fontWeight: '600', color: '#64748B', marginTop: 1 },
  headerScoreBadge: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  headerScoreText: { fontSize: 13, fontWeight: '900', color: '#2563EB' },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tabItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 11,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabItemActive: { borderBottomColor: '#2563EB' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#94A3B8' },
  tabTextActive: { color: '#2563EB' },

  // Result banner
  resultBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1.5,
    paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 12,
  },
  resultBannerText: { flex: 1, fontSize: 13, fontWeight: '800' },
  markBadge: {
    backgroundColor: '#DCFCE7', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  markBadgeText: { fontSize: 12, fontWeight: '900', color: '#16A34A' },

  // Question card
  questionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#3B82F6',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 3,
  },
  qHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  sectionTag: {
    backgroundColor: '#EFF6FF', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  sectionTagText: { fontSize: 10, fontWeight: '800', color: '#2563EB' },
  diffTag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  diffTagText: { fontSize: 10, fontWeight: '800' },
  qCounter: { marginLeft: 'auto', fontSize: 12, fontWeight: '700', color: '#94A3B8' },
  markRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  markChip: { backgroundColor: '#DCFCE7', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
  markChipPos: { fontSize: 11, fontWeight: '800', color: '#16A34A' },
  directionCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    padding: 12,
    marginBottom: 14,
  },
  directionLabel: { fontSize: 11, fontWeight: '900', color: '#2563EB', textTransform: 'uppercase', marginBottom: 6 },
  directionText: { fontSize: 13, fontWeight: '600', color: '#334155', lineHeight: 20 },
  directionImage: { width: '100%', height: 180, marginTop: 10, borderRadius: 10, backgroundColor: '#E2E8F0' },
  qText: { fontSize: 15, fontWeight: '800', color: '#1E293B', lineHeight: 23, marginBottom: 14 },
  questionImage: { width: '100%', height: 220, marginBottom: 14, borderRadius: 10, backgroundColor: '#E2E8F0' },

  // Options
  optionsList: { gap: 10, marginBottom: 14 },
  optionItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    borderRadius: 12, borderWidth: 2,
  },
  optionLabel: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, flexShrink: 0,
  },
  optionLabelText: { fontSize: 13, fontWeight: '900' },
  optionBody: { flex: 1, gap: 8 },
  optionText: { fontSize: 14, fontWeight: '700' },
  optionImage: { width: '100%', height: 180, borderRadius: 10, backgroundColor: '#E2E8F0' },
  yourAnswerTag: {
    backgroundColor: '#DCFCE7', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  yourAnswerTagText: { fontSize: 9, fontWeight: '900', color: '#16A34A' },

  // Correct answer box
  correctAnswerBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: '#FFFBEB', borderRadius: 10, borderWidth: 1, borderColor: '#FDE68A',
    padding: 10, marginBottom: 12,
  },
  correctAnswerText: { flex: 1 },
  correctAnswerLabel: { fontSize: 12, fontWeight: '700', color: '#92400E' },
  correctAnswerLine: { fontSize: 12, fontWeight: '900', color: '#16A34A', lineHeight: 18 },

  // Explanation
  explainToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1.5, borderColor: '#BFDBFE', borderRadius: 12,
    paddingVertical: 11, paddingHorizontal: 14, marginBottom: 4,
  },
  explainToggleText: { fontSize: 13, fontWeight: '800', color: '#2563EB' },
  explainBlock: { marginTop: 10, gap: 10 },
  explainSection: {
    backgroundColor: '#F8FAFC', borderRadius: 12,
    padding: 12, borderWidth: 1, borderColor: '#E2E8F0',
  },
  insightBox: { backgroundColor: '#F0F9FF', borderColor: '#BAE6FD' },
  trapBox: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  trickBox: { backgroundColor: '#FAF5FF', borderColor: '#E9D5FF' },
  explainSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 7 },
  explainSectionTitle: { fontSize: 12, fontWeight: '900', color: '#2563EB' },
  explainBody: { fontSize: 13, fontWeight: '600', color: '#334155', lineHeight: 20 },
  memoryTrickRow: { flexDirection: 'row', alignItems: 'flex-start' },
  memoryTrickIcon: { fontSize: 13, fontWeight: '700', color: '#5B21B6', fontStyle: 'italic' },
  memoryTrickBody: { flex: 1 },
  keyPointRow: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    borderLeftWidth: 3, borderRadius: 6,
    paddingLeft: 10, paddingVertical: 8,
    paddingRight: 8, marginBottom: 6,
  },
  kpOptionBadge: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  kpOptionBadgeText: { fontSize: 11, fontWeight: '900' },
  kpText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#334155', lineHeight: 18 },

  // Navigation
  navRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 4,
  },
  navBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: 22,
  },
  navBtnPrev: { backgroundColor: '#FF6B2C' },
  navBtnNext: { backgroundColor: '#2563EB' },
  navBtnDisabled: { backgroundColor: '#F1F5F9' },
  navBtnText: { fontSize: 13, fontWeight: '900', color: '#FFF' },
  navCenter: { alignItems: 'center' },
  navCenterText: { fontSize: 14, fontWeight: '900', color: '#1E293B' },
  navCenterSub: { fontSize: 10, fontWeight: '600', color: '#64748B', marginTop: 2 },

  // Dot progress
  dotRow: { gap: 6, paddingHorizontal: 4, paddingVertical: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotLegend: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 8 },
  dotLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dotLegendDot: { width: 8, height: 8, borderRadius: 4 },
  dotLegendText: { fontSize: 10, fontWeight: '600', color: '#64748B' },

  // Score tab
  scoreHero: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18,
    marginBottom: 12,
    shadowColor: '#3B82F6', shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, elevation: 3,
  },
  scoreHeroLabel: { fontSize: 12, fontWeight: '700', color: '#64748B', marginBottom: 2 },
  scoreHeroBig: { fontSize: 48, fontWeight: '900', lineHeight: 56 },
  scoreHeroOf: { fontSize: 22, fontWeight: '700', color: '#94A3B8' },
  scoreHeroSub: { fontSize: 13, fontWeight: '700', color: '#64748B', marginTop: 4 },

  // Cards
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#3B82F6', shadowOpacity: 0.07,
    shadowOffset: { width: 0, height: 3 }, shadowRadius: 10, elevation: 2,
  },
  cardTitle: { fontSize: 14, fontWeight: '900', color: '#1E293B', marginBottom: 12 },
  sectionBreakdownCard: { marginBottom: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  sectionBreakdownMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  sectionBreakdownMetaText: { fontSize: 11, fontWeight: '700', color: '#64748B' },

  // Rating
  avgRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
  avgRatingText: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  reviewSubLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 },
  starsRow: { flexDirection: 'row', gap: 2, marginBottom: 10 },
  reviewInput: {
    borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13, fontWeight: '600', color: '#1E293B',
    minHeight: 80, textAlignVertical: 'top', marginBottom: 10,
    backgroundColor: '#F8FAFC',
  },
  recommendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  recommendText: { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  saveBtn: {
    backgroundColor: '#2563EB', borderRadius: 12,
    paddingVertical: 13, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: '#2563EB', shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 }, shadowRadius: 10, elevation: 4,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },

  // Community reviews
  reviewCard: {
    borderWidth: 1, borderColor: '#F1F5F9', borderRadius: 12,
    padding: 10, marginBottom: 8, backgroundColor: '#FAFCFF',
  },
  reviewAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center',
  },
  reviewAvatarText: { fontSize: 13, fontWeight: '900', color: '#2563EB' },
  reviewDate: { fontSize: 10, fontWeight: '600', color: '#94A3B8', marginTop: 1 },
  reviewText: { fontSize: 12, fontWeight: '600', color: '#334155', lineHeight: 18 },
  recommendedBadge: {
    backgroundColor: '#DCFCE7', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  recommendedBadgeText: { fontSize: 9, fontWeight: '900', color: '#16A34A' },

  // Leaderboard
  lbRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderRadius: 10, paddingHorizontal: 6,
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  lbRank: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  lbRankText: { fontSize: 12, fontWeight: '900' },
  lbAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center',
  },
  lbAvatarText: { fontSize: 14, fontWeight: '900', color: '#2563EB' },
  lbName: { flex: 1, fontSize: 13, fontWeight: '700', color: '#1E293B' },
  lbScoreWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  lbScoreText: { fontSize: 13, fontWeight: '900', color: '#1E293B' },

  // Empty state
  emptyWrap: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyText: { fontSize: 13, fontWeight: '600', color: '#94A3B8', textAlign: 'center' },

  // Local note
  localNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#FFFBEB', borderRadius: 10, borderWidth: 1, borderColor: '#FDE68A',
    padding: 10, marginBottom: 12,
  },
  localNoteText: { flex: 1, fontSize: 12, fontWeight: '700', color: '#B45309', lineHeight: 18 },
});

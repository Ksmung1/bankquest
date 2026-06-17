import { useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import ExamMathRenderer from '@/components/math/MathRenderer';
import { flattenSectionQuestions, getImageUrl, shouldDisableMathForSection, type FlattenedLiveQuestion, type LiveMockPayload, type LiveOption } from '@/constants/mock-live-types';
import { getCachedMockTestById, getCachedSession } from '@/lib/app-data-cache';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';

function InlineImage({ uri, style }: { uri?: string | null; style: object }) {
  if (!uri) return null;
  return <Image source={{ uri }} style={style} resizeMode="contain" />;
}

type AttemptSnapshot = {
  answers: Record<string, string>;
  saved_for_review: Record<string, true>;
};

export default function SavedQuestionsPage() {
  const params = useLocalSearchParams<{ testid: string; attemptId?: string; localAttemptId?: string }>();
  const router = useRouter();
  const [payload, setPayload] = useState<LiveMockPayload | null>(null);
  const [attempt, setAttempt] = useState<AttemptSnapshot | null>(null);
  const [openKeys, setOpenKeys] = useState<Record<string, true>>({});

  useEffect(() => {
    async function load() {
      const testId = String(params.testid);
      if (!supabase || !hasSupabaseConfig) {
        router.replace('/auth');
        return;
      }

      const session = await getCachedSession();
      if (!session?.user?.id) {
        router.replace('/auth');
        return;
      }

      const cachedPayload = await getCachedMockTestById(testId);

      setPayload(cachedPayload ?? null);

      if (params.attemptId && supabase && hasSupabaseConfig) {
        const { data } = await supabase
          .from('mock_test_attempts')
          .select('answers,saved_for_review')
          .eq('id', String(params.attemptId))
          .maybeSingle();

        setAttempt({
          answers: (data?.answers ?? {}) as Record<string, string>,
          saved_for_review: (data?.saved_for_review ?? {}) as Record<string, true>,
        });
        return;
      }
    }

    load();
  }, [params.attemptId, params.localAttemptId, params.testid]);

  const savedQuestions = useMemo(() => {
    if (!payload || !attempt) return [] as FlattenedLiveQuestion[];
    const flattened = payload.sections.flatMap((section, index) => {
      const globalOffset = payload.sections.slice(0, index).reduce((sum, current) => sum + flattenSectionQuestions(current).length, 0);
      return flattenSectionQuestions(section, globalOffset);
    });
    return flattened.filter((question) => Boolean(attempt.saved_for_review[question.answerKey]));
  }, [attempt, payload]);

  const toggleOpen = (key: string) => {
    setOpenKeys((prev) => (prev[key] ? Object.fromEntries(Object.entries(prev).filter(([entryKey]) => entryKey !== key)) as Record<string, true> : { ...prev, [key]: true }));
  };

  return (
    <View style={styles.page}>
      <View style={styles.pageHeader}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={20} color="#1E293B" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.pageTitle} numberOfLines={1}>Saved Questions</Text>
          <Text style={styles.pageSubtitle}>{payload?.title ?? 'Current Test'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {savedQuestions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No saved questions</Text>
            <Text style={styles.emptyText}>Use the Save button on a question to add it here.</Text>
          </View>
        ) : (
          savedQuestions.map((question, index) => {
            const isOpen = Boolean(openKeys[question.answerKey]);
            const selectedAnswer = attempt?.answers?.[question.answerKey] ?? null;
            const directionImageUrl = question.direction?.imageUrl ?? null;
            const questionImageUrl = getImageUrl(question.image, question.imageUrl);
            const disableMath = shouldDisableMathForSection(question.sectionName);

            return (
              <View key={question.answerKey} style={styles.card}>
                <Pressable onPress={() => toggleOpen(question.answerKey)} style={styles.cardHeader}>
                  <View style={styles.cardHeaderMain}>
                    <Text style={styles.cardCount}>Saved {index + 1}</Text>
                    <ExamMathRenderer content={question.question} numberOfLines={isOpen ? undefined : 2} textStyle={styles.cardQuestion} disableMath={disableMath} />
                  </View>
                  <MaterialCommunityIcons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#64748B" />
                </Pressable>

                {isOpen ? (
                  <View style={styles.cardBody}>
                    {question.direction ? (
                      <View style={styles.directionCard}>
                        <Text style={styles.directionLabel}>{question.direction.setType ? question.direction.setType.replaceAll('_', ' ') : 'Direction'}</Text>
                        <ExamMathRenderer content={question.direction.directionText} textStyle={styles.directionText} disableMath={disableMath} />
                        <InlineImage uri={directionImageUrl} style={styles.directionImage} />
                      </View>
                    ) : null}

                    <InlineImage uri={questionImageUrl} style={styles.questionImage} />

                    <View style={styles.optionsList}>
                      {question.options.map((opt: LiveOption) => {
                        const isCorrect = opt.id === question.correctAnswer;
                        const isSelected = opt.id === selectedAnswer;
                        return (
                          <View key={opt.id} style={[styles.optionItem, isCorrect && styles.optionCorrect, isSelected && styles.optionSelected]}>
                            <View style={styles.optionLabel}><Text style={styles.optionLabelText}>{opt.id}</Text></View>
                            <View style={styles.optionBody}>
                              <ExamMathRenderer content={opt.text} textStyle={styles.optionText} disableMath={disableMath} />
                              <InlineImage uri={getImageUrl(opt.image, opt.imageUrl)} style={styles.optionImage} />
                            </View>
                            {isCorrect ? <MaterialCommunityIcons name="check-circle" size={18} color="#16A34A" /> : null}
                            {!isCorrect && isSelected ? <MaterialCommunityIcons name="bookmark" size={16} color="#D97706" /> : null}
                          </View>
                        );
                      })}
                    </View>

                    <View style={styles.detailBox}>
                      <Text style={styles.detailTitle}>Correct Answer</Text>
                      <View style={styles.correctAnswerRow}>
                        <Text style={styles.correctAnswerPrefix}>{`${question.correctAnswer} - `}</Text>
                        <View style={styles.correctAnswerBody}>
                          <ExamMathRenderer content={question.options.find((option) => option.id === question.correctAnswer)?.text ?? ''} textStyle={styles.detailText} disableMath={disableMath} />
                        </View>
                      </View>
                    </View>

                    <View style={styles.detailBox}>
                      <Text style={styles.detailTitle}>Explanation</Text>
                      <ExamMathRenderer content={question.explanation ?? 'No explanation provided for this question.'} textStyle={styles.detailText} disableMath={disableMath} />
                    </View>

                    {question.examInsight ? (
                      <View style={styles.detailBox}>
                        <Text style={styles.detailTitle}>Exam Insight</Text>
                        <ExamMathRenderer content={question.examInsight} textStyle={styles.detailText} disableMath={disableMath} />
                      </View>
                    ) : null}

                    {question.commonTrap ? (
                      <View style={styles.detailBox}>
                        <Text style={styles.detailTitle}>Common Trap</Text>
                        <ExamMathRenderer content={question.commonTrap} textStyle={styles.detailText} disableMath={disableMath} />
                      </View>
                    ) : null}

                    {question.memoryTrick ? (
                      <View style={styles.detailBox}>
                        <Text style={styles.detailTitle}>Memory Trick</Text>
                        <ExamMathRenderer content={question.memoryTrick} textStyle={styles.detailText} disableMath={disableMath} />
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#EAF3FF' },
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
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: { fontSize: 16, fontWeight: '900', color: '#1E293B' },
  pageSubtitle: { fontSize: 11, fontWeight: '600', color: '#64748B', marginTop: 1 },
  container: { padding: 14, paddingBottom: 28, gap: 12 },
  emptyCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '900', color: '#1E293B' },
  emptyText: { marginTop: 8, fontSize: 13, fontWeight: '600', color: '#64748B', textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, gap: 10 },
  cardHeaderMain: { flex: 1, gap: 4 },
  cardCount: { fontSize: 11, fontWeight: '800', color: '#D97706', textTransform: 'uppercase' },
  cardQuestion: { fontSize: 14, fontWeight: '700', color: '#1E293B', lineHeight: 21 },
  cardBody: { paddingHorizontal: 14, paddingBottom: 14 },
  directionCard: { backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#DBEAFE', padding: 12, marginBottom: 14 },
  directionLabel: { fontSize: 11, fontWeight: '900', color: '#2563EB', textTransform: 'uppercase', marginBottom: 6 },
  directionText: { fontSize: 13, fontWeight: '600', color: '#334155', lineHeight: 20 },
  directionImage: { width: '100%', height: 180, marginTop: 10, borderRadius: 10, backgroundColor: '#E2E8F0' },
  questionImage: { width: '100%', height: 220, marginBottom: 14, borderRadius: 10, backgroundColor: '#E2E8F0' },
  optionsList: { gap: 10, marginBottom: 14 },
  optionItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 12, borderWidth: 2, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  optionCorrect: { borderColor: '#86EFAC', backgroundColor: '#F0FDF4' },
  optionSelected: { borderColor: '#FCD34D' },
  optionLabel: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#E2E8F0', backgroundColor: '#fff', flexShrink: 0 },
  optionLabelText: { fontSize: 13, fontWeight: '900', color: '#64748B' },
  optionBody: { flex: 1, gap: 8 },
  optionText: { fontSize: 14, fontWeight: '700', color: '#334155' },
  optionImage: { width: '100%', height: 180, borderRadius: 10, backgroundColor: '#E2E8F0' },
  detailBox: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 10 },
  detailTitle: { fontSize: 12, fontWeight: '900', color: '#2563EB', marginBottom: 6 },
  detailText: { fontSize: 13, fontWeight: '600', color: '#334155', lineHeight: 20 },
  correctAnswerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  correctAnswerPrefix: { fontSize: 13, fontWeight: '700', color: '#334155' },
  correctAnswerBody: { flex: 1 },
});

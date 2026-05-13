import AsyncStorage from '@react-native-async-storage/async-storage';

export type PausedMockAttempt = {
  testId: string;
  testTitle: string;
  exam: string;
  subjectIndex: number;
  questionIndexBySubject: Record<string, number>;
  answers: Record<string, 'A' | 'B' | 'C' | 'D'>;
  covered: Record<string, true>;
  savedForReview: Record<string, true>;
  sectionSecondsLeft: Record<string, number>;
  updatedAt: string;
};

const PAUSED_ATTEMPT_KEY = 'bankCore:paused-mock-attempt';

export async function getPausedMockAttempt(): Promise<PausedMockAttempt | null> {
  const raw = await AsyncStorage.getItem(PAUSED_ATTEMPT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PausedMockAttempt;
  } catch {
    return null;
  }
}

export async function setPausedMockAttempt(value: PausedMockAttempt): Promise<void> {
  await AsyncStorage.setItem(PAUSED_ATTEMPT_KEY, JSON.stringify(value));
}

export async function clearPausedMockAttempt(): Promise<void> {
  await AsyncStorage.removeItem(PAUSED_ATTEMPT_KEY);
}

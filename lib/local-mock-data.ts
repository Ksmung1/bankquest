import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { normalizeMockPayload, type LiveMockListItem, type LiveMockPayload } from '@/constants/mock-live-types';

export type LocalMockAttempt = {
  id: string;
  testId: string;
  answers: Record<string, string>;
  attempted_total: number;
  covered: Record<string, true>;
  saved_for_review: Record<string, true>;
  score_total: number;
  section_seconds_left: Record<string, number>;
  subject_scores: { subject: string; correct: number; attempted: number; total: number; score?: number }[];
  submitted_at: string;
  time_spent_seconds: number;
  total_questions: number;
};

const LOCAL_MOCKS_KEY = 'bankCore:local-mock-tests';
const LOCAL_ATTEMPTS_KEY = 'bankCore:local-mock-attempts';
const DB_NAME = 'bankCore-local-data';
const STORE_NAME = 'kv';

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isWebIndexedDbAvailable() {
  return Platform.OS === 'web' && typeof indexedDB !== 'undefined';
}

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

async function getStoredValue(key: string) {
  if (!isWebIndexedDbAvailable()) {
    return AsyncStorage.getItem(key);
  }

  const db = await openDb();
  return new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error(`Failed to read ${key}.`));
  });
}

async function setStoredValue(key: string, value: string) {
  if (!isWebIndexedDbAvailable()) {
    await AsyncStorage.setItem(key, value);
    return;
  }

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(value, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Failed to write ${key}.`));
  });
}

export async function getLocalMockTests(): Promise<LiveMockListItem[]> {
  const raw = await getStoredValue(LOCAL_MOCKS_KEY);
  return safeParse<LiveMockListItem[]>(raw, []).map((item) => ({
    ...item,
    payload: normalizeMockPayload(item.payload),
  }));
}

export async function clearLocalMockTests() {
  await setStoredValue(LOCAL_MOCKS_KEY, JSON.stringify([]));
}

export async function upsertLocalMockTest(payload: LiveMockPayload, override?: { exam?: string; title?: string }) {
  const normalizedPayload = normalizeMockPayload(payload);
  const current = await getLocalMockTests();
  const item: LiveMockListItem = {
    id: String(normalizedPayload.testId),
    title: String(override?.title?.trim() || normalizedPayload.title || 'Mock Test'),
    exam: String(override?.exam?.trim() || normalizedPayload.exam || 'Exam'),
    source: 'local',
    payload: {
      ...normalizedPayload,
      title: String(override?.title?.trim() || normalizedPayload.title || 'Mock Test'),
      exam: String(override?.exam?.trim() || normalizedPayload.exam || 'Exam'),
    },
  };

  const next = current.filter((entry) => entry.id !== item.id);
  next.unshift(item);
  await setStoredValue(LOCAL_MOCKS_KEY, JSON.stringify(next));
  return item;
}

export async function getLocalMockTestById(testId: string) {
  const current = await getLocalMockTests();
  return current.find((entry) => entry.id === testId) ?? null;
}

export async function getLocalMockAttempts(): Promise<Record<string, LocalMockAttempt>> {
  const raw = await getStoredValue(LOCAL_ATTEMPTS_KEY);
  return safeParse<Record<string, LocalMockAttempt>>(raw, {});
}

export async function saveLocalMockAttempt(attempt: Omit<LocalMockAttempt, 'id' | 'submitted_at'> & { id?: string; submitted_at?: string }) {
  const id = attempt.id ?? `local-${Date.now()}`;
  const submitted_at = attempt.submitted_at ?? new Date().toISOString();
  const current = await getLocalMockAttempts();
  const nextAttempt: LocalMockAttempt = {
    ...attempt,
    id,
    submitted_at,
  };
  current[id] = nextAttempt;
  await setStoredValue(LOCAL_ATTEMPTS_KEY, JSON.stringify(current));
  return nextAttempt;
}

export async function getLocalMockAttemptById(id: string) {
  const attempts = await getLocalMockAttempts();
  return attempts[id] ?? null;
}

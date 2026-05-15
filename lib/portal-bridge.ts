import { supabase } from '@/lib/supabase';

type PortalReportInput = {
  projectName: string;
  reportType: string;
  quality: string;
  headline: string;
  message: string;
};

type MockCompletionInput = {
  type: 'mock_test_completed';
  projectName: string;
  attemptId: string;
  testId: string;
  testTitle: string;
  scoreTotal: number;
  attemptedTotal: number;
  totalQuestions: number;
  timeSpentSeconds: number;
};

type ProjectLoginInput = {
  type: 'project_login';
  projectName: string;
  message?: string;
};

type RankUnlockedInput = {
  type: 'rank_unlocked';
  projectName: string;
  rankKey: string;
  rankLabel: string;
  averageScore: number;
};

type CardCollectedInput = {
  type: 'card_collected';
  projectName: string;
  cardKey: string;
  cardLabel: string;
};

type PortalActivityInput =
  | MockCompletionInput
  | ProjectLoginInput
  | RankUnlockedInput
  | CardCollectedInput;

async function getAccessToken() {
  if (!supabase) {
    throw new Error('Supabase is unavailable.');
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error('Login required.');
  }

  return token;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function postToPortal(path: string, body: unknown) {
  const accessToken = await getAccessToken();
  const response = await fetchWithTimeout(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }).catch((error) => {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Portal request timed out. Please try again.');
    }

    throw error;
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? 'Request failed.');
  }

  return payload;
}

export async function submitPortalReport(input: PortalReportInput) {
  return postToPortal('/api/portal/report', input);
}

export async function trackActivity(_user: string, action: PortalActivityInput) {
  return postToPortal('/api/portal/activity', action);
}

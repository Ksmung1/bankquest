import { supabase } from '@/lib/supabase';

type PortalReportInput = {
  projectName: string;
  reportType: string;
  quality: string;
  headline: string;
  message: string;
};

type MockCompletionInput = {
  projectName: string;
  testId: string;
  testTitle: string;
  scoreTotal: number;
  attemptedTotal: number;
  totalQuestions: number;
  timeSpentSeconds: number;
};

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

async function postToPortal(path: string, body: unknown) {
  const accessToken = await getAccessToken();
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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

export async function trackActivity(_user: string, action: MockCompletionInput) {
  return postToPortal('/api/portal/activity', action);
}

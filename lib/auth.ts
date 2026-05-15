import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';
import { cacheSession, prewarmAppData } from '@/lib/app-data-cache';
import { syncUserProfile } from '@/lib/user-profile';

type AuthMode = 'login' | 'signup';

type AuthFields = {
  email: string;
  password: string;
  phoneNumber?: string;
  username?: string;
};

export type AuthSubmitResult =
  | { status: 'signed_in' }
  | { status: 'verification_required' }
  | { status: 'already_registered_unverified' };

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY.');
  }

  return supabase;
}

function getWebsiteAuthUrl() {
  const websiteUrl =
    process.env.EXPO_PUBLIC_WEBSITE_B_URL ??
    process.env.EXPO_PUBLIC_APP_URL;

  if (websiteUrl) {
    return `${websiteUrl.replace(/\/+$/, '')}/auth`;
  }

  return Linking.createURL('/auth');
}

export function formatAuthErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Authentication failed.';
  const normalized = message.toLowerCase();

  if (normalized.includes('email rate limit exceeded') || normalized.includes('rate limit')) {
    return 'Too many email requests were sent. Please wait a few minutes before trying again.';
  }

  if (normalized.includes('email not confirmed')) {
    return 'Email not verified yet. Open the verification email from Supabase, then sign in again.';
  }

  if (normalized.includes('invalid login credentials')) {
    return 'Invalid email or password. If you just signed up, verify your email first and then log in.';
  }

  if (normalized.includes('duplicate key value') && normalized.includes('username')) {
    return 'Username is already taken.';
  }

  return message;
}

export function shouldOfferResendVerification(input: unknown) {
  if (!input) return false;
  if (typeof input === 'string') {
    const normalized = input.toLowerCase();
    return normalized.includes('verify your account') || normalized.includes('email not verified') || normalized.includes('already registered');
  }
  if (typeof input === 'object' && 'status' in input) {
    const status = String((input as { status?: string }).status);
    return status === 'verification_required' || status === 'already_registered_unverified';
  }
  return false;
}

export async function resendVerificationEmail(email: string) {
  const client = requireSupabase();
  const cleanEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!cleanEmail) {
    throw new Error('Enter your email address first.');
  }

  if (!emailRegex.test(cleanEmail)) {
    throw new Error('Enter a valid email address.');
  }

  const { error } = await client.auth.resend({
    type: 'signup',
    email: cleanEmail,
  });

  if (error) {
    throw error;
  }
}

export async function checkUsernameAvailability(username: string) {
  const client = requireSupabase();
  const normalizedUsername = username.trim().toLowerCase();

  if (!normalizedUsername) {
    return { available: false, reason: 'Please enter a username.' as const };
  }

  if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
    return {
      available: false,
      reason: 'Username must be 3 to 24 characters using lowercase letters, numbers, or underscores.' as const,
    };
  }

  const { data, error } = await client
    .from('user_profiles')
    .select('user_id')
    .eq('username', normalizedUsername)
    .limit(1);

  if (error) {
    throw error;
  }

  return {
    available: (data?.length ?? 0) === 0,
    reason: (data?.length ?? 0) === 0 ? null : ('Username is already taken.' as const),
  };
}

export async function sendPasswordReset(email: string) {
  const client = requireSupabase();
  const cleanEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!cleanEmail) {
    throw new Error('Enter your email address first.');
  }

  if (!emailRegex.test(cleanEmail)) {
    throw new Error('Enter a valid email address.');
  }

  const redirectTo = getWebsiteAuthUrl();
  const { error } = await client.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo,
  });

  if (error) {
    throw error;
  }
}

export function validateAuthFields(mode: AuthMode, fields: AuthFields) {
  const cleanEmail = fields.email.trim().toLowerCase();
  const password = fields.password;
  const phoneNumber = (fields.phoneNumber ?? '').replace(/\D/g, '');
  const username = fields.username?.trim().toLowerCase() ?? '';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!cleanEmail || !password) {
    throw new Error('Please enter your email and password.');
  }

  if (!emailRegex.test(cleanEmail)) {
    throw new Error('Enter a valid email address.');
  }

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  if (mode === 'signup' && phoneNumber.length !== 10) {
    throw new Error('Enter a valid 10-digit phone number.');
  }

  if (mode === 'signup' && !username) {
    throw new Error('Please enter a username.');
  }

  if (mode === 'signup' && !/^[a-z0-9_]{3,24}$/.test(username)) {
    throw new Error('Username must be 3 to 24 characters using lowercase letters, numbers, or underscores.');
  }

  return {
    cleanEmail,
    phoneNumber,
    username,
  };
}

export async function waitForSession(attempts = 12, delayMs = 200) {
  const client = requireSupabase();

  for (let i = 0; i < attempts; i += 1) {
    const { data } = await client.auth.getSession();
    if (data.session?.user?.id) {
      return data.session;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return null;
}

async function syncSessionUser() {
  const session = await waitForSession();
  const user = session?.user;

  if (!user?.id) {
    throw new Error('Authentication succeeded but no session was created.');
  }

  await syncUserProfile({
    userId: user.id,
    email: user.email,
    metadata: user.user_metadata ?? null,
  });

  return session;
}

export async function submitEmailAuth(mode: AuthMode, fields: AuthFields): Promise<AuthSubmitResult> {
  const client = requireSupabase();
  const { cleanEmail, phoneNumber, username } = validateAuthFields(mode, fields);

  if (mode === 'login') {
    const { data, error } = await client.auth.signInWithPassword({
      email: cleanEmail,
      password: fields.password,
    });

    if (error) {
      throw error;
    }

    if (data.session) {
      cacheSession(data.session);
    }

    const session = data.session ?? await waitForSession(6, 100);
    const user = session?.user;
    if (!user?.id) {
      throw new Error('Authentication succeeded but no session was created.');
    }

    cacheSession(session);
    void syncUserProfile({
      userId: user.id,
      email: user.email,
      metadata: user.user_metadata ?? null,
    }).catch(() => undefined);
    prewarmAppData(user.id);
    return { status: 'signed_in' };
  }

  const { data, error } = await client.auth.signUp({
    email: cleanEmail,
    password: fields.password,
    options: {
      data: {
        full_name: username,
        name: username,
        username,
        phone_number: phoneNumber,
      },
    },
  });

  if (error) {
    throw error;
  }

  const user = data.user ?? data.session?.user;
  const identities = ((user as { identities?: unknown[] | null } | null)?.identities ?? null);
  if (user?.id && Array.isArray(identities) && identities.length === 0) {
    return { status: 'already_registered_unverified' };
  }

  if (user?.id) {
    if (data.session) {
      cacheSession(data.session);
    }
    await syncUserProfile({
      userId: user.id,
      email: user.email,
      metadata: user.user_metadata ?? null,
    });
    prewarmAppData(user.id);
  }

  return { status: 'verification_required' };
}

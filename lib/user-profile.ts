import { supabase } from '@/lib/supabase';

type SyncInput = {
  userId: string;
  email?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function syncUserProfile(input: SyncInput): Promise<void> {
  if (!supabase) return;
  const { data: sessionData } = await supabase.auth.getSession();
  const sessionUserId = sessionData.session?.user?.id ?? null;

  if (!sessionUserId || sessionUserId !== input.userId) {
    return;
  }

  const rawName = (input.metadata?.name as string | undefined) ?? (input.metadata?.full_name as string | undefined) ?? input.email?.split('@')[0];
  const username = typeof input.metadata?.username === 'string' ? input.metadata.username.trim().toLowerCase() : input.email?.split('@')[0]?.trim().toLowerCase() || null;
  const displayName = rawName?.trim() || username || 'User';
  const avatarUrl = ((input.metadata?.avatar_url as string | undefined) ?? (input.metadata?.picture as string | undefined) ?? null) as string | null;
  const phoneNumber = typeof input.metadata?.phone_number === 'string' ? input.metadata.phone_number.replace(/\D/g, '').slice(0, 10) : null;

  const profilePayload = {
    user_id: input.userId,
    email: input.email?.trim().toLowerCase() ?? null,
    username,
    display_name: displayName,
    phone_number: phoneNumber,
    avatar_url: avatarUrl,
    last_seen_at: new Date().toISOString(),
  };

  const { error: profileError } = await supabase.from('user_profiles').upsert(profilePayload, { onConflict: 'user_id' });
  if (profileError) {
    console.error('Failed to sync user_profiles', profileError);
  }

  // Ensure a user_stats row exists even before the first attempt lands.
  const { error: statsError } = await supabase.from('user_stats').upsert({ user_id: input.userId }, { onConflict: 'user_id' });
  if (statsError) {
    console.error('Failed to sync user_stats', statsError);
  }
}

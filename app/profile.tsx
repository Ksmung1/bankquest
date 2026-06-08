import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';

import {
  cacheSession,
  clearAppDataCache,
  getCachedLeaderboardPreview,
  getCachedSession,
  getCachedUserDashboardData,
  invalidateLeaderboardCache,
  invalidateUserProfileCache,
} from '@/lib/app-data-cache';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { AppChrome } from '@/components/app-chrome';

type ProfileData = {
  userId: string;
  email: string | null;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  phoneNumber: string | null;
};

type PerformanceData = {
  testsCompleted: number;
  accuracyPct: number;
  totalTimeSeconds: number;
};

type LeaderboardEntry = {
  id: string;
  name: string;
  rank_label: string;
  initials: string;
};

const defaultPerformance: PerformanceData = {
  testsCompleted: 0,
  accuracyPct: 0,
  totalTimeSeconds: 0,
};

const heroIllustration = require('@/assets/images/history-hero.png');
const securityIllustration = require('@/assets/images/legend.png');
const scaleValue = (value: number, factor: number) => Math.round(value * factor);
const guestProfile: ProfileData = {
  userId: 'guest',
  email: null,
  username: 'guest',
  displayName: 'Guest User',
  avatarUrl: null,
  phoneNumber: null,
};

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours}h ${minutes}m`;
}

function getInitials(name: string) {
  const normalized = name.trim();
  if (!normalized) return 'U';
  return normalized
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function getOwnedAvatarStoragePath(url: string | null, sessionUserId: string) {
  if (!url) return null;
  const marker = '/storage/v1/object/public/avatars/';
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const rawPath = url.slice(index + marker.length).split('?')[0];
  const decodedPath = decodeURIComponent(rawPath);
  if (!decodedPath.startsWith(`${sessionUserId}/`)) {
    return null;
  }
  return decodedPath;
}

export default function ProfilePage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isMobile = width < 760;
  const isTablet = width < 1150;
  const pageScale = isMobile ? 0.6 : 0.8;

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [draftUsername, setDraftUsername] = useState('');
  const [draftAvatarUrl, setDraftAvatarUrl] = useState('');
  const [performance, setPerformance] = useState<PerformanceData>(defaultPerformance);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userRankLabel, setUserRankLabel] = useState('Unranked');
  const [userRankScore, setUserRankScore] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(false);
  const webInputReset = Platform.OS === 'web' ? ({ outlineWidth: 0, outlineStyle: 'none', boxShadow: 'none' } as const) : null;

  const loadProfileRow = async (sessionUserId: string, fallbackAvatar: string | null, fallbackUsername?: string | null, fallbackEmail?: string | null) => {
    if (!supabase) return;

    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('username,display_name,avatar_url,phone_number')
        .eq('user_id', sessionUserId)
        .maybeSingle();

      const username = String(data?.username ?? fallbackUsername ?? '').trim().toLowerCase() || 'user';
      const displayName = String(data?.display_name ?? username).trim() || username;
      const avatarUrl = (data?.avatar_url as string | null) ?? fallbackAvatar;
      const phoneNumber = data?.phone_number ? String(data.phone_number).trim() : null;

      setProfile({
        userId: sessionUserId,
        email: fallbackEmail ?? null,
        username,
        displayName,
        avatarUrl,
        phoneNumber,
      });
      setDraftUsername(username);
      setDraftAvatarUrl(avatarUrl ?? '');

      const [dashboard, leaderboardPreview, statsRes] = await Promise.all([
        getCachedUserDashboardData(sessionUserId),
        getCachedLeaderboardPreview(),
        supabase.from('user_stats').select('global_rank,total_score').eq('user_id', sessionUserId).maybeSingle(),
      ]);
      setPerformance({
        testsCompleted: dashboard.testsCompleted,
        accuracyPct: dashboard.accuracyPct,
        totalTimeSeconds: dashboard.totalTimeSeconds,
      });
      setLeaderboard(leaderboardPreview);
      setUserRankLabel(statsRes.data?.global_rank ? `#${statsRes.data.global_rank}` : 'Unranked');
      setUserRankScore(Number(statsRes.data?.total_score ?? 0));
    } catch (error) {
      console.error('Failed to load profile row', error);
      const username = String(fallbackUsername ?? '').trim().toLowerCase() || 'user';
      setProfile({
        userId: sessionUserId,
        email: fallbackEmail ?? null,
        username,
        displayName: username,
        avatarUrl: fallbackAvatar,
        phoneNumber: null,
      });
      setDraftUsername(username);
      setDraftAvatarUrl(fallbackAvatar ?? '');
      setPerformance(defaultPerformance);
      setLeaderboard([]);
      setUserRankLabel('Unranked');
      setUserRankScore(0);
    }
  };

  useEffect(() => {
    let initialResolved = false;

    async function init() {
      try {
        if (!supabase || !hasSupabaseConfig) {
          setProfile(guestProfile);
          setPerformance(defaultPerformance);
          setLeaderboard([]);
          setUserRankLabel('Unranked');
          setUserRankScore(0);
          setCheckingAuth(false);
          return;
        }

        const session = await getCachedSession();
        initialResolved = true;

        if (!session?.user?.id) {
          setProfile(guestProfile);
          setPerformance(defaultPerformance);
          setLeaderboard([]);
          setUserRankLabel('Unranked');
          setUserRankScore(0);
          setCheckingAuth(false);
          return;
        }

        const emailName = session.user.email?.split('@')[0];
        const metaUsername = (session.user.user_metadata?.username as string | undefined) ?? emailName;
        const fallbackAvatar =
          (session.user.user_metadata?.avatar_url as string | undefined) ??
          (session.user.user_metadata?.picture as string | undefined) ??
          null;
        await loadProfileRow(session.user.id, fallbackAvatar, metaUsername, session.user.email ?? null);
      } catch (error) {
        console.error('Failed to initialize profile page', error);
      } finally {
        setCheckingAuth(false);
      }
    }

    void init();

    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      cacheSession(session);

      if (event === 'INITIAL_SESSION' || initialResolved) {
        setCheckingAuth(false);
      }

      if (!session?.user?.id) {
        if (event === 'SIGNED_OUT') {
          clearAppDataCache();
          setProfile(guestProfile);
          setPerformance(defaultPerformance);
          setLeaderboard([]);
          setUserRankLabel('Unranked');
          setUserRankScore(0);
        }
        return;
      }

      const emailName = session.user.email?.split('@')[0];
      const metaUsername = (session.user.user_metadata?.username as string | undefined) ?? emailName;
      const fallbackAvatar =
        (session.user.user_metadata?.avatar_url as string | undefined) ??
        (session.user.user_metadata?.picture as string | undefined) ??
        null;
      void loadProfileRow(session.user.id, fallbackAvatar, metaUsername, session.user.email ?? null);
    });

    return () => data.subscription.unsubscribe();
  }, [router]);

  const activeProfile = profile ?? guestProfile;
  const avatarPreview = editing ? draftAvatarUrl.trim() || activeProfile.avatarUrl || null : activeProfile.avatarUrl || null;
  const accountHandle = useMemo(
    () => `@${editing ? draftUsername || activeProfile.username || 'user' : activeProfile.username || 'user'}`,
    [activeProfile.username, draftUsername, editing]
  );

  const startEditing = () => {
    if (!profile) return;
    setDraftUsername(profile.username);
    setDraftAvatarUrl(profile.avatarUrl ?? '');
    setEditing(true);
  };

  const cancelEditing = () => {
    if (!profile) return;
    setDraftUsername(profile.username);
    setDraftAvatarUrl(profile.avatarUrl ?? '');
    setEditing(false);
  };

  const uploadAvatar = async () => {
    if (!supabase || !profile?.userId) return;

    setUploadingAvatar(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Media library permission is required to choose a profile picture.');
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      const asset = result.assets[0];
      const extension = asset.fileName?.split('.').pop()?.toLowerCase() || asset.mimeType?.split('/')[1] || 'jpg';
      const contentType = asset.mimeType || `image/${extension}`;
      const path = `${profile.userId}/avatar-${Date.now()}.${extension}`;

      const response = await fetch(asset.uri);
      const blob = await response.blob();

      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, blob, {
        contentType,
        upsert: true,
      });

      if (uploadError) {
        throw uploadError;
      }

      const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const nextUrl = publicUrlData.publicUrl;
      if (!nextUrl) {
        throw new Error('Avatar uploaded but no public URL was returned.');
      }

      setDraftAvatarUrl(nextUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload avatar.';
      Alert.alert('Upload failed', message);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const saveProfile = async () => {
    if (!supabase || !profile?.userId) return;

    const cleanUsername = draftUsername.trim().toLowerCase();
    const cleanAvatarUrl = draftAvatarUrl.trim();

    if (!cleanUsername) {
      Alert.alert('Invalid username', 'Username is required.');
      return;
    }

    if (!/^[a-z0-9_]{3,24}$/.test(cleanUsername)) {
      Alert.alert('Invalid username', 'Use 3 to 24 lowercase letters, numbers, or underscores.');
      return;
    }

    if (cleanAvatarUrl && !/^https?:\/\//i.test(cleanAvatarUrl)) {
      Alert.alert('Invalid image URL', 'Profile picture must be a valid http or https image URL.');
      return;
    }

    setSaving(true);
    try {
      const previousAvatarPath = getOwnedAvatarStoragePath(profile.avatarUrl, profile.userId);
      const nextAvatarPath = getOwnedAvatarStoragePath(cleanAvatarUrl || null, profile.userId);

      const { error: profileError } = await supabase.from('user_profiles').upsert(
        {
          user_id: profile.userId,
          username: cleanUsername,
          display_name: cleanUsername,
          avatar_url: cleanAvatarUrl || null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

      if (profileError) {
        throw profileError;
      }

      const { error: authError } = await supabase.auth.updateUser({
        data: {
          name: cleanUsername,
          full_name: cleanUsername,
          username: cleanUsername,
          avatar_url: cleanAvatarUrl || null,
        },
      });

      const { data: refreshed } = await supabase.auth.getSession();
      cacheSession(refreshed.session ?? null);
      invalidateUserProfileCache(profile.userId);
      invalidateLeaderboardCache();

      setProfile((current) =>
        current
          ? {
              ...current,
              username: cleanUsername,
              displayName: cleanUsername,
              avatarUrl: cleanAvatarUrl || null,
            }
          : current
      );
      setDraftUsername(cleanUsername);
      setDraftAvatarUrl(cleanAvatarUrl);
      setEditing(false);

      if (previousAvatarPath && previousAvatarPath !== nextAvatarPath) {
        await supabase.storage.from('avatars').remove([previousAvatarPath]);
      }

      if (authError) {
        Alert.alert('Saved', 'Profile updated, but auth metadata refresh failed. The latest username and avatar are still saved in your profile.');
        return;
      }

      Alert.alert('Saved', 'Profile updated successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update profile.';
      Alert.alert('Update failed', message);
    } finally {
      setSaving(false);
    }
  };

  if (checkingAuth) {
    return (
      <AppChrome active="profile">
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.stateTitle}>Loading your profile</Text>
          <Text style={styles.stateText}>Checking your session and pulling account details.</Text>
        </View>
      </AppChrome>
    );
  }

  const displayName = activeProfile.displayName || activeProfile.username;
  const isGuest = activeProfile.userId === 'guest';

  return (
    <AppChrome active="profile">
      <ScrollView contentContainerStyle={[styles.container, { padding: scaleValue(16, pageScale), paddingBottom: scaleValue(28, pageScale) }]}>
        <View
          style={[
            styles.hero,
            isTablet && styles.heroTablet,
            isMobile && styles.heroMobile,
            {
              borderRadius: scaleValue(isMobile ? 28 : 34, pageScale),
              padding: scaleValue(isMobile ? 22 : 28, pageScale),
              gap: scaleValue(30, pageScale),
              marginBottom: scaleValue(24, pageScale),
            },
          ]}
        >
          <View style={styles.heroContent}>
            <View style={[styles.heroLeft, isMobile && styles.heroLeftMobile]}>
              <View style={[styles.avatarWrap, { width: scaleValue(isMobile ? 100 : 120, pageScale), height: scaleValue(isMobile ? 100 : 120, pageScale) }]}>
                {avatarPreview ? (
                  <Image source={{ uri: avatarPreview }} style={[styles.avatarImage, { width: scaleValue(isMobile ? 100 : 120, pageScale), height: scaleValue(isMobile ? 100 : 120, pageScale), borderRadius: scaleValue(34, pageScale), borderWidth: Math.max(3, scaleValue(6, pageScale)) }]} />
                ) : (
                  <View style={[styles.avatarFallback, { width: scaleValue(isMobile ? 100 : 120, pageScale), height: scaleValue(isMobile ? 100 : 120, pageScale), borderRadius: scaleValue(34, pageScale), borderWidth: Math.max(3, scaleValue(6, pageScale)) }]}>
                    <Text style={[styles.avatarFallbackText, { fontSize: scaleValue(isMobile ? 48 : 42, pageScale) }]}>{getInitials(displayName)}</Text>
                  </View>
                )}
                <View style={[styles.editBadge, { right: scaleValue(-4, pageScale), bottom: scaleValue(-4, pageScale), width: scaleValue(42, pageScale), height: scaleValue(42, pageScale), borderRadius: scaleValue(21, pageScale), borderWidth: Math.max(2, scaleValue(4, pageScale)) }]}>
                  <MaterialCommunityIcons name="pencil" size={scaleValue(16, pageScale)} color="#FFFFFF" />
                </View>
              </View>

              <View style={styles.heroText}>
                <Text style={[styles.welcomeText, { fontSize: scaleValue(19, pageScale), marginTop: scaleValue(8, pageScale) }]}>Welcome back,</Text>
                <Text style={[styles.heroName, { fontSize: scaleValue(isMobile ? 48 : 52, pageScale), lineHeight: scaleValue(isMobile ? 50 : 54, pageScale), marginTop: scaleValue(8, pageScale) }]}>{displayName}</Text>
                <Text style={[styles.usernameText, { fontSize: scaleValue(18, pageScale), marginBottom: scaleValue(10, pageScale) }]}>{accountHandle}</Text>
                <Text style={[styles.emailText, { fontSize: scaleValue(15, pageScale), marginBottom: scaleValue(22, pageScale) }]}>{activeProfile.email || 'No email available'}</Text>

                <View style={[styles.heroActions, { gap: scaleValue(12, pageScale) }]}>
                  {editing && !isGuest ? (
                    <>
                      <Pressable onPress={cancelEditing} style={({ pressed }) => [styles.cancelButton, { paddingVertical: scaleValue(16, pageScale), paddingHorizontal: scaleValue(22, pageScale), borderRadius: scaleValue(18, pageScale), borderWidth: Math.max(1, scaleValue(2, pageScale)) }, pressed && styles.pressed]}>
                        <Text style={[styles.cancelButtonText, { fontSize: scaleValue(15, pageScale) }]}>Cancel</Text>
                      </Pressable>
                      <Pressable onPress={saveProfile} disabled={saving} style={({ pressed }) => [styles.editProfileButton, { paddingVertical: scaleValue(16, pageScale), paddingHorizontal: scaleValue(26, pageScale), borderRadius: scaleValue(18, pageScale), gap: scaleValue(8, pageScale) }, (pressed || saving) && styles.pressed]}>
                        {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={[styles.editProfileButtonText, { fontSize: scaleValue(15, pageScale) }]}>Save Profile</Text>}
                      </Pressable>
                    </>
                  ) : isGuest ? (
                    <Pressable onPress={() => router.replace('/auth')} style={({ pressed }) => [styles.editProfileButton, { paddingVertical: scaleValue(16, pageScale), paddingHorizontal: scaleValue(26, pageScale), borderRadius: scaleValue(18, pageScale), gap: scaleValue(8, pageScale) }, pressed && styles.pressed]}>
                      <MaterialCommunityIcons name="login" size={scaleValue(16, pageScale)} color="#FFFFFF" />
                      <Text style={[styles.editProfileButtonText, { fontSize: scaleValue(15, pageScale) }]}>Sign In</Text>
                    </Pressable>
                  ) : (
                    <Pressable onPress={startEditing} style={({ pressed }) => [styles.editProfileButton, { paddingVertical: scaleValue(16, pageScale), paddingHorizontal: scaleValue(26, pageScale), borderRadius: scaleValue(18, pageScale), gap: scaleValue(8, pageScale) }, pressed && styles.pressed]}>
                      <MaterialCommunityIcons name="pencil-outline" size={scaleValue(16, pageScale)} color="#FFFFFF" />
                      <Text style={[styles.editProfileButtonText, { fontSize: scaleValue(15, pageScale) }]}>Edit Profile</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </View>

            <View style={[styles.stats, { marginTop: scaleValue(22, pageScale), gap: scaleValue(18, pageScale) }]}>
              <View style={[styles.statCard, isMobile && styles.statCardMobile, { padding: scaleValue(22, pageScale), borderRadius: scaleValue(28, pageScale), gap: scaleValue(18, pageScale) }]}>
                <View style={[styles.statIcon, styles.blueIcon, { width: scaleValue(isMobile ? 68 : 82, pageScale), height: scaleValue(isMobile ? 68 : 82, pageScale), borderRadius: scaleValue(24, pageScale) }]}>
                  <MaterialCommunityIcons name="clipboard-text-outline" size={scaleValue(isMobile ? 34 : 30, pageScale)} color="#3567FF" />
                </View>
                <View style={[styles.statCopy, isMobile && styles.statCopyMobile]}>
                  <Text style={[styles.statValue, { fontSize: scaleValue(34, pageScale), lineHeight: scaleValue(36, pageScale) }]}>{performance.testsCompleted}</Text>
                  <Text style={[styles.statTitle, { marginTop: scaleValue(8, pageScale), fontSize: scaleValue(16, pageScale) }]}>Tests Completed</Text>
                  <Text style={[styles.statNote, { marginTop: scaleValue(8, pageScale), fontSize: scaleValue(14, pageScale) }]}>Keep it up! You&apos;re doing great!</Text>
                </View>
              </View>

              <View style={[styles.statCard, isMobile && styles.statCardMobile, { padding: scaleValue(22, pageScale), borderRadius: scaleValue(28, pageScale), gap: scaleValue(18, pageScale) }]}>
                <View style={[styles.statIcon, styles.greenIcon, { width: scaleValue(isMobile ? 68 : 82, pageScale), height: scaleValue(isMobile ? 68 : 82, pageScale), borderRadius: scaleValue(24, pageScale) }]}>
                  <MaterialCommunityIcons name="target" size={scaleValue(isMobile ? 34 : 30, pageScale)} color="#31B54F" />
                </View>
                <View style={[styles.statCopy, isMobile && styles.statCopyMobile]}>
                  <Text style={[styles.statValue, { fontSize: scaleValue(34, pageScale), lineHeight: scaleValue(36, pageScale) }]}>{performance.accuracyPct}%</Text>
                  <Text style={[styles.statTitle, { marginTop: scaleValue(8, pageScale), fontSize: scaleValue(16, pageScale) }]}>Accuracy</Text>
                  <Text style={[styles.statNote, { marginTop: scaleValue(8, pageScale), fontSize: scaleValue(14, pageScale) }]}>Focus and practice makes perfect!</Text>
                </View>
              </View>

              <View style={[styles.statCard, isMobile && styles.statCardMobile, { padding: scaleValue(22, pageScale), borderRadius: scaleValue(28, pageScale), gap: scaleValue(18, pageScale) }]}>
                <View style={[styles.statIcon, styles.purpleIcon, { width: scaleValue(isMobile ? 68 : 82, pageScale), height: scaleValue(isMobile ? 68 : 82, pageScale), borderRadius: scaleValue(24, pageScale) }]}>
                  <MaterialCommunityIcons name="clock-outline" size={scaleValue(isMobile ? 34 : 30, pageScale)} color="#9A59FF" />
                </View>
                <View style={[styles.statCopy, isMobile && styles.statCopyMobile]}>
                  <Text style={[styles.statValue, { fontSize: scaleValue(34, pageScale), lineHeight: scaleValue(36, pageScale) }]}>{formatDuration(performance.totalTimeSeconds)}</Text>
                  <Text style={[styles.statTitle, { marginTop: scaleValue(8, pageScale), fontSize: scaleValue(16, pageScale) }]}>Study Time</Text>
                  <Text style={[styles.statNote, { marginTop: scaleValue(8, pageScale), fontSize: scaleValue(14, pageScale) }]}>Every minute counts!</Text>
                </View>
              </View>
            </View>
          </View>

          {!isMobile ? (
            <View style={styles.heroRight}>
              <Image source={heroIllustration} style={[styles.heroImage, { height: scaleValue(250, pageScale) }]} resizeMode="contain" />
            </View>
          ) : null}
        </View>

        <View style={[styles.detailsCard, { marginTop: scaleValue(24, pageScale), borderRadius: scaleValue(isMobile ? 28 : 34, pageScale), padding: scaleValue(isMobile ? 22 : 30, pageScale) }]}>
          <View style={[styles.cardHead, isMobile && styles.cardHeadMobile]}>
            <View style={styles.cardHeadLeft}>
              <View style={[styles.cardHeadIcon, { width: scaleValue(64, pageScale), height: scaleValue(64, pageScale), borderRadius: scaleValue(22, pageScale) }]}>
                <MaterialCommunityIcons name="trophy-outline" size={scaleValue(30, pageScale)} color="#3567FF" />
              </View>
              <View style={styles.cardHeadCopy}>
                <Text style={[styles.cardHeadTitle, { fontSize: scaleValue(36, pageScale), lineHeight: scaleValue(38, pageScale), marginBottom: scaleValue(6, pageScale) }]}>Ranking & Leaderboard</Text>
                <Text style={[styles.cardHeadText, { fontSize: scaleValue(15, pageScale), lineHeight: scaleValue(22, pageScale) }]}>
                  Track where you stand and see the current top performers across BankCore.
                </Text>
              </View>
            </View>

            <Image source={securityIllustration} style={[styles.securityImage, { width: scaleValue(isMobile ? 100 : 130, pageScale), height: scaleValue(100, pageScale) }]} resizeMode="contain" />
          </View>

          {editing ? (
            <>
              <View style={[styles.detailBox, { padding: scaleValue(24, pageScale), borderRadius: scaleValue(28, pageScale), marginBottom: scaleValue(18, pageScale), gap: scaleValue(20, pageScale) }]}>
                <View style={[styles.detailLeft, { gap: scaleValue(18, pageScale) }]}>
                  <View style={[styles.detailIcon, styles.purpleDetail, { width: scaleValue(74, pageScale), height: scaleValue(74, pageScale), borderRadius: scaleValue(22, pageScale) }]}>
                    <MaterialCommunityIcons name="account-outline" size={scaleValue(32, pageScale)} color="#9657FF" />
                  </View>

                  <View style={styles.detailContent}>
                    <Text style={[styles.detailLabel, { fontSize: scaleValue(13, pageScale), marginBottom: scaleValue(8, pageScale) }]}>USERNAME</Text>
                    <TextInput
                      value={draftUsername}
                      onChangeText={(text) => setDraftUsername(text.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                      style={[styles.detailInput, { minHeight: scaleValue(54, pageScale), borderRadius: scaleValue(18, pageScale), paddingHorizontal: scaleValue(16, pageScale), fontSize: scaleValue(16, pageScale), borderWidth: Math.max(1, scaleValue(2, pageScale)) }, webInputReset as any]}
                      placeholder="username"
                      placeholderTextColor="#94A3B8"
                      autoCapitalize="none"
                      maxLength={24}
                    />
                    <Text style={[styles.detailText, { fontSize: scaleValue(15, pageScale), lineHeight: scaleValue(22, pageScale) }]}>Use 3 to 24 lowercase letters, numbers, or underscores.</Text>
                  </View>
                </View>
              </View>

              <View style={[styles.detailBox, isMobile && styles.detailBoxMobile, { padding: scaleValue(24, pageScale), borderRadius: scaleValue(28, pageScale), marginBottom: scaleValue(18, pageScale), gap: scaleValue(20, pageScale) }]}>
                <View style={[styles.detailLeft, { gap: scaleValue(18, pageScale) }]}>
                  <View style={[styles.detailIcon, styles.greenDetail, { width: scaleValue(74, pageScale), height: scaleValue(74, pageScale), borderRadius: scaleValue(22, pageScale) }]}>
                    <MaterialCommunityIcons name="image-outline" size={scaleValue(32, pageScale)} color="#31B54F" />
                  </View>

                  <View style={styles.detailContent}>
                    <Text style={[styles.detailLabel, { fontSize: scaleValue(13, pageScale), marginBottom: scaleValue(8, pageScale) }]}>PROFILE PHOTO</Text>
                    <TextInput
                      value={draftAvatarUrl}
                      onChangeText={setDraftAvatarUrl}
                      style={[styles.detailInput, styles.topGapInput, { minHeight: scaleValue(54, pageScale), borderRadius: scaleValue(18, pageScale), paddingHorizontal: scaleValue(16, pageScale), fontSize: scaleValue(16, pageScale), borderWidth: Math.max(1, scaleValue(2, pageScale)), marginBottom: scaleValue(10, pageScale) }, webInputReset as any]}
                      placeholder="https://example.com/avatar.png"
                      placeholderTextColor="#94A3B8"
                      autoCapitalize="none"
                    />
                    <Text style={[styles.detailText, { fontSize: scaleValue(15, pageScale), lineHeight: scaleValue(22, pageScale) }]}>Upload from your device or paste a direct image URL.</Text>
                  </View>
                </View>

                <View style={[styles.detailActions, isMobile && styles.detailActionsMobile]}>
                  <Pressable onPress={uploadAvatar} disabled={uploadingAvatar} style={({ pressed }) => [styles.uploadButton, { paddingVertical: scaleValue(16, pageScale), paddingHorizontal: scaleValue(24, pageScale), borderRadius: scaleValue(18, pageScale), borderWidth: Math.max(1, scaleValue(2, pageScale)), gap: scaleValue(8, pageScale) }, (pressed || uploadingAvatar) && styles.pressed]}>
                    {uploadingAvatar ? <ActivityIndicator size="small" color="#3567FF" /> : <MaterialCommunityIcons name="upload" size={scaleValue(18, pageScale)} color="#3567FF" />}
                    <Text style={[styles.uploadButtonText, { fontSize: scaleValue(15, pageScale) }]}>{uploadingAvatar ? 'Uploading...' : 'Upload Photo'}</Text>
                  </Pressable>
                </View>
              </View>
            </>
          ) : (
            <>
              {isGuest ? (
                <View style={[styles.rankSummaryBox, { padding: scaleValue(24, pageScale), borderRadius: scaleValue(28, pageScale), marginBottom: scaleValue(18, pageScale), gap: scaleValue(20, pageScale) }]}>
                  <View style={[styles.detailLeft, { gap: scaleValue(18, pageScale) }]}>
                    <View style={[styles.detailIcon, styles.purpleDetail, { width: scaleValue(74, pageScale), height: scaleValue(74, pageScale), borderRadius: scaleValue(22, pageScale) }]}>
                      <MaterialCommunityIcons name="account-clock-outline" size={scaleValue(32, pageScale)} color="#9657FF" />
                    </View>

                    <View style={styles.detailContent}>
                      <Text style={[styles.detailLabel, { fontSize: scaleValue(13, pageScale), marginBottom: scaleValue(8, pageScale) }]}>GUEST MODE</Text>
                      <Text style={[styles.detailTitle, { fontSize: scaleValue(28, pageScale), lineHeight: scaleValue(30, pageScale), marginBottom: scaleValue(8, pageScale) }]}>Instant profile preview</Text>
                      <Text style={[styles.detailText, { fontSize: scaleValue(15, pageScale), lineHeight: scaleValue(22, pageScale) }]}>Sign in to sync your stats, rank, avatar, and saved progress.</Text>
                    </View>
                  </View>
                </View>
              ) : null}

              <View style={[styles.rankSummaryBox, { padding: scaleValue(24, pageScale), borderRadius: scaleValue(28, pageScale), marginBottom: scaleValue(18, pageScale), gap: scaleValue(20, pageScale) }]}>
                <View style={[styles.detailLeft, { gap: scaleValue(18, pageScale) }]}>
                  <View style={[styles.detailIcon, styles.purpleDetail, { width: scaleValue(74, pageScale), height: scaleValue(74, pageScale), borderRadius: scaleValue(22, pageScale) }]}>
                    <MaterialCommunityIcons name="medal-outline" size={scaleValue(32, pageScale)} color="#9657FF" />
                  </View>

                  <View style={styles.detailContent}>
                    <Text style={[styles.detailLabel, { fontSize: scaleValue(13, pageScale), marginBottom: scaleValue(8, pageScale) }]}>YOUR RANK</Text>
                    <Text style={[styles.detailTitle, { fontSize: scaleValue(28, pageScale), lineHeight: scaleValue(30, pageScale), marginBottom: scaleValue(8, pageScale) }]}>{userRankLabel}</Text>
                    <Text style={[styles.detailText, { fontSize: scaleValue(15, pageScale), lineHeight: scaleValue(22, pageScale) }]}>{`Total score: ${userRankScore}`}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.leaderboardList}>
                {leaderboard.length === 0 ? (
                  <Text style={[styles.detailText, { fontSize: scaleValue(15, pageScale), lineHeight: scaleValue(22, pageScale) }]}>No leaderboard entries yet.</Text>
                ) : (
                  leaderboard.map((entry, index) => (
                    <View
                      key={entry.id}
                      style={[
                        styles.leaderboardRow,
                        {
                          padding: scaleValue(18, pageScale),
                          borderRadius: scaleValue(24, pageScale),
                          marginBottom: scaleValue(14, pageScale),
                          gap: scaleValue(16, pageScale),
                        },
                      ]}
                    >
                      <View style={[styles.leaderboardAvatar, { width: scaleValue(62, pageScale), height: scaleValue(62, pageScale), borderRadius: scaleValue(20, pageScale) }]}>
                        <Text style={[styles.leaderboardAvatarText, { fontSize: scaleValue(22, pageScale) }]}>{entry.initials}</Text>
                      </View>

                      <View style={styles.leaderboardCopy}>
                        <Text style={[styles.leaderboardName, { fontSize: scaleValue(24, pageScale), lineHeight: scaleValue(26, pageScale) }]}>{entry.name}</Text>
                        <Text style={[styles.leaderboardSubtext, { fontSize: scaleValue(14, pageScale), marginTop: scaleValue(4, pageScale) }]}>
                          {index === 0 ? 'Top performer right now' : 'Climbing the BankCore leaderboard'}
                        </Text>
                      </View>

                      <View style={[styles.leaderboardRankChip, { paddingHorizontal: scaleValue(16, pageScale), paddingVertical: scaleValue(10, pageScale), borderRadius: scaleValue(999, pageScale) }]}>
                        <Text style={[styles.leaderboardRankText, { fontSize: scaleValue(14, pageScale) }]}>{entry.rank_label}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </>
          )}
        </View>

  
      </ScrollView>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 28,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  stateTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#16234F',
  },
  stateText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 420,
  },
  hero: {
    backgroundColor: '#F8FBFF',
    borderRadius: 34,
    padding: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 30,
    shadowColor: '#4566FF',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
    marginBottom: 24,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#EDF2FF',
  },
  heroTablet: {
    flexDirection: 'column',
  },
  heroMobile: {
    padding: 22,
    borderRadius: 28,
  },
  heroContent: {
    flex: 1,
  },
  heroLeft: {
    flexDirection: 'row',
    gap: 24,
    alignItems: 'flex-start',
  },
  heroLeftMobile: {
    flexDirection: 'column',
  },
  avatarWrap: {
    position: 'relative',
    width: 120,
    height: 120,
    borderRadius: 34,
    overflow: 'visible',
  },
  avatarImage: {
    width: 120,
    height: 120,
    borderRadius: 34,
    borderWidth: 6,
    borderColor: '#FFFFFF',
  },
  avatarFallback: {
    width: 120,
    height: 120,
    borderRadius: 34,
    backgroundColor: '#3567FF',
    borderWidth: 6,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontSize: 42,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  editBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FF7A2F',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  heroText: {
    flex: 1,
  },
  welcomeText: {
    fontSize: 19,
    fontWeight: '500',
    color: '#6878A3',
    marginTop: 8,
  },
  heroName: {
    fontSize: 52,
    lineHeight: 54,
    fontWeight: '900',
    color: '#16234F',
    marginTop: 8,
  },
  usernameText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#3567FF',
    marginBottom: 10,
  },
  emailText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6D7BA3',
    marginBottom: 22,
  },
  heroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  editProfileButton: {
    paddingVertical: 16,
    paddingHorizontal: 26,
    borderRadius: 18,
    backgroundColor: '#FF6D2F',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  editProfileButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  cancelButton: {
    paddingVertical: 16,
    paddingHorizontal: 22,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#DCE6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    color: '#3567FF',
    fontSize: 15,
    fontWeight: '800',
  },
  heroRight: {
    width: 430,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroRightMobile: {
    width: '100%',
  },
  heroImage: {
    width: '100%',
    height: 250,
  },
  stats: {
    marginTop: 22,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: 240,
    backgroundColor: '#FFFFFF',
    padding: 22,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    shadowColor: '#4566FF',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 3,
  },
  statCardMobile: {
    flexBasis: '31%',
    maxWidth: '31%',
    minWidth: 0,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  statIcon: {
    width: 82,
    height: 82,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blueIcon: {
    backgroundColor: '#EDF3FF',
  },
  greenIcon: {
    backgroundColor: '#EFFFF2',
  },
  purpleIcon: {
    backgroundColor: '#F5ECFF',
  },
  statCopy: {
    flex: 1,
  },
  statCopyMobile: {
    flex: 0,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 34,
    lineHeight: 36,
    fontWeight: '900',
    color: '#16234F',
  },
  statTitle: {
    marginTop: 8,
    fontSize: 16,
    fontWeight: '700',
    color: '#6F7BA3',
  },
  statNote: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#8A96BA',
  },
  detailsCard: {
    marginTop: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 34,
    padding: 30,
    shadowColor: '#4566FF',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
  },
  rankSummaryBox: {
    backgroundColor: '#FAFBFF',
    borderWidth: 2,
    borderColor: '#EDF2FF',
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
    gap: 20,
  },
  cardHeadMobile: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  cardHeadLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    flex: 1,
  },
  cardHeadCopy: {
    flex: 1,
  },
  cardHeadIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: '#EDF3FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeadTitle: {
    fontSize: 36,
    lineHeight: 38,
    fontWeight: '900',
    color: '#16234F',
    marginBottom: 6,
  },
  cardHeadText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: '#6D7BA3',
  },
  securityImage: {
    width: 130,
    height: 100,
  },
  detailBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 20,
    padding: 24,
    borderRadius: 28,
    backgroundColor: '#FAFBFF',
    borderWidth: 2,
    borderColor: '#EDF2FF',
    marginBottom: 18,
  },
  detailBoxMobile: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  detailLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 18,
    flex: 1,
  },
  detailIcon: {
    width: 74,
    height: 74,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  purpleDetail: {
    backgroundColor: '#F5ECFF',
  },
  greenDetail: {
    backgroundColor: '#EFFFF2',
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: '#8B96BA',
    marginBottom: 8,
  },
  detailTitle: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '900',
    color: '#16234F',
    marginBottom: 8,
  },
  detailText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: '#7C88AC',
  },
  detailInput: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#DCE6FF',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '700',
    color: '#16234F',
  },
  topGapInput: {
    marginBottom: 10,
  },
  detailActions: {
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  detailActionsMobile: {
    width: '100%',
  },
  leaderboardList: {
    marginTop: 4,
  },
  leaderboardRow: {
    backgroundColor: '#FAFBFF',
    borderWidth: 2,
    borderColor: '#EDF2FF',
    flexDirection: 'row',
    alignItems: 'center',
  },
  leaderboardAvatar: {
    backgroundColor: '#EDF3FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderboardAvatarText: {
    fontWeight: '900',
    color: '#3567FF',
  },
  leaderboardCopy: {
    flex: 1,
  },
  leaderboardName: {
    fontWeight: '900',
    color: '#16234F',
  },
  leaderboardSubtext: {
    fontWeight: '600',
    color: '#7C88AC',
  },
  leaderboardRankChip: {
    backgroundColor: '#EFFFEF',
  },
  leaderboardRankText: {
    fontWeight: '800',
    color: '#31B54F',
  },
  uploadButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#DCE6FF',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  uploadButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#3567FF',
  },
  achievement: {
    marginTop: 24,
    backgroundColor: '#FFF8EB',
    borderRadius: 34,
    padding: 26,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 20,
    shadowColor: '#4566FF',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
  },
  achievementTablet: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  achievementMobile: {
    padding: 22,
    borderRadius: 28,
  },
  achievementLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    flex: 1,
  },
  achievementLeftMobile: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  medalImage: {
    width: 92,
    height: 92,
  },
  achievementCopy: {
    flex: 1,
  },
  achievementTitle: {
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '900',
    color: '#16234F',
    marginBottom: 8,
  },
  achievementText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: '#7B88AC',
  },
  achievementRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  achievementRightTablet: {
    width: '100%',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 20,
  },
  miniStat: {
    alignItems: 'center',
  },
  miniIcon: {
    width: 70,
    height: 70,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  miniTextValue: {
    fontSize: 28,
    fontWeight: '900',
    color: '#3567FF',
  },
  miniLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#16234F',
  },
  viewAllButton: {
    paddingVertical: 18,
    paddingHorizontal: 26,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  viewAllButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#16234F',
  },
  pressed: {
    opacity: 0.85,
  },
});

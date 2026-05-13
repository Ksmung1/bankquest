import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = (Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {}) as Record<string, string | undefined>;
const isNodeRuntime = typeof window === 'undefined' && Platform.OS === 'web';
const isWebRuntime = Platform.OS === 'web' && typeof window !== 'undefined';
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabasePublishableKey;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

const memoryStorage = new Map<string, string>();

const webSessionStorage = isWebRuntime
  ? {
      getItem: async (key: string) => {
        try {
          return window.localStorage.getItem(key);
        } catch {
          return memoryStorage.get(key) ?? null;
        }
      },
      setItem: async (key: string, value: string) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          memoryStorage.set(key, value);
        }
      },
      removeItem: async (key: string) => {
        try {
          window.localStorage.removeItem(key);
        } catch {
          memoryStorage.delete(key);
        }
      },
    }
  : undefined;

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        // Keep sessions across browser restarts until explicit logout or token invalidation.
        persistSession: !isNodeRuntime,
        autoRefreshToken: !isNodeRuntime,
        detectSessionInUrl: isWebRuntime,
        storage: isNodeRuntime ? undefined : isWebRuntime ? webSessionStorage : AsyncStorage,
      },
    })
  : null;

import Constants from 'expo-constants';

type SessionLike = {
  user?: {
    user_metadata?: Record<string, unknown> | null;
  } | null;
} | null;

const extra = (Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {}) as Record<string, string | undefined>;

export function getPortalEntryUrl() {
  const configured =
    process.env.EXPO_PUBLIC_WEBSITE_A_URL ??
    extra.websiteAUrl ??
    'https://thanghou-liandou.vercel.app';

  return configured.replace(/\/+$/, '');
}

export function isPortalLinkedSession(session: SessionLike) {
  const metadata = session?.user?.user_metadata ?? {};
  const externalId = typeof metadata.external_id === 'string' ? metadata.external_id.trim() : '';
  const provider = typeof metadata.sso_provider === 'string' ? metadata.sso_provider.trim() : '';

  return Boolean(externalId && provider === 'thanghou-liandou');
}

export function isSSOCallbackPath(pathname: string, params: Record<string, string | string[] | undefined>) {
  if (pathname !== '/auth') {
    return false;
  }

  const sso = params.sso;
  return sso === '1' || (Array.isArray(sso) && sso.includes('1'));
}

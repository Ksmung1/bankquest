const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const SSO_ISSUER = 'thanghou-liandou';
const SSO_AUDIENCE = 'bankquest';

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

function getSharedSecret() {
  return getEnv('SSO_SHARED_SECRET');
}

function normalizeUrl(value) {
  return String(value).replace(/\/+$/, '');
}

function getAppUrl(request) {
  void request;

  const websiteBUrl = process.env.WEBSITE_B_URL || process.env.EXPO_PUBLIC_APP_URL;
  if (!websiteBUrl) {
    throw new Error('Missing WEBSITE_B_URL environment variable.');
  }

  return normalizeUrl(websiteBUrl);
}

function getAuthCallbackUrl(request, extraParams = {}) {
  const authUrl = new URL('/auth', getAppUrl(request));

  Object.entries(extraParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      authUrl.searchParams.set(key, String(value));
    }
  });

  return authUrl.toString();
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(input, secret) {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed SSO token.');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`, getSharedSecret());
  if (!safeEqual(signature, expectedSignature)) {
    throw new Error('Invalid SSO token signature.');
  }

  const header = JSON.parse(base64UrlDecode(encodedHeader));
  const payload = JSON.parse(base64UrlDecode(encodedPayload));

  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new Error('Unsupported SSO token format.');
  }

  return payload;
}

function verifySSOToken(token) {
  const payload = parseJwt(token);
  const now = Math.floor(Date.now() / 1000);

  if (payload.iss !== SSO_ISSUER) {
    throw new Error('Invalid SSO issuer.');
  }

  if (payload.aud !== SSO_AUDIENCE) {
    throw new Error('Invalid SSO audience.');
  }

  if (!payload.id || !payload.email || !payload.name || !payload.role || !payload.jti) {
    throw new Error('Incomplete SSO token payload.');
  }

  if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number' || typeof payload.nbf !== 'number') {
    throw new Error('Invalid SSO token timestamps.');
  }

  if (payload.nbf > now || payload.exp < now) {
    throw new Error('Expired or inactive SSO token.');
  }

  return payload;
}

function requireVerifiedSSOToken(request) {
  const token = request.query?.token;

  if (!token || typeof token !== 'string') {
    throw new Error('Missing SSO token.');
  }

  return verifySSOToken(token);
}

function getServiceSupabase() {
  return createClient(
    getEnv('EXPO_PUBLIC_SUPABASE_URL'),
    getEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

async function findUserByEmail(admin, email) {
  let page = 1;

  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });

    if (error) {
      throw error;
    }

    const found = (data?.users ?? []).find((user) => String(user.email || '').toLowerCase() === email);
    if (found) {
      return found;
    }

    if (!data?.users?.length || data.users.length < 200) {
      return null;
    }

    page += 1;
  }
}

async function ensureReplayGuard(admin, tokenPayload) {
  const { error } = await admin
    .from('sso_consumed_tokens')
    .insert({
      jti: tokenPayload.jti,
      issuer: tokenPayload.iss,
      audience: tokenPayload.aud,
      external_id: tokenPayload.id,
      email: tokenPayload.email.toLowerCase(),
      expires_at: new Date(tokenPayload.exp * 1000).toISOString(),
      consumed_at: new Date().toISOString(),
    });

  if (!error) {
    return;
  }

  if (String(error.message || '').toLowerCase().includes('duplicate')) {
    throw new Error('This SSO token was already used.');
  }

  throw error;
}

async function provisionLocalUser(tokenPayload) {
  const admin = getServiceSupabase();
  const normalizedEmail = String(tokenPayload.email).trim().toLowerCase();

  await ensureReplayGuard(admin, {
    ...tokenPayload,
    email: normalizedEmail,
  });

  const identityLookup = await admin
    .from('sso_identities')
    .select('user_id')
    .eq('provider', tokenPayload.iss)
    .eq('external_id', tokenPayload.id)
    .maybeSingle();

  if (identityLookup.error) {
    throw identityLookup.error;
  }

  let authUser = null;

  if (identityLookup.data?.user_id) {
    const userRes = await admin.auth.admin.getUserById(identityLookup.data.user_id);
    if (userRes.error) {
      throw userRes.error;
    }
    authUser = userRes.data.user;
  }

  if (!authUser) {
    authUser = await findUserByEmail(admin, normalizedEmail);
  }

  if (!authUser) {
    const createdUser = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password: crypto.randomBytes(32).toString('hex'),
      email_confirm: true,
      user_metadata: {
        name: tokenPayload.name,
        full_name: tokenPayload.name,
        role: tokenPayload.role,
        sso_provider: tokenPayload.iss,
        external_id: tokenPayload.id,
      },
    });

    if (createdUser.error || !createdUser.data.user) {
      throw createdUser.error || new Error('Failed to create BankQuest user.');
    }

    authUser = createdUser.data.user;
  } else {
    const updatedUser = await admin.auth.admin.updateUserById(authUser.id, {
      email_confirm: true,
      user_metadata: {
        ...(authUser.user_metadata || {}),
        name: tokenPayload.name,
        full_name: tokenPayload.name,
        role: tokenPayload.role,
        sso_provider: tokenPayload.iss,
        external_id: tokenPayload.id,
      },
    });

    if (updatedUser.error || !updatedUser.data.user) {
      throw updatedUser.error || new Error('Failed to update BankQuest user.');
    }

    authUser = updatedUser.data.user;
  }

  const profilePayload = {
    user_id: authUser.id,
    email: normalizedEmail,
    username: normalizedEmail.split('@')[0],
    display_name: tokenPayload.name,
    external_id: tokenPayload.id,
    auth_source: 'sso',
    last_seen_at: new Date().toISOString(),
  };

  const [profileRes, statsRes, identityRes] = await Promise.all([
    admin.from('user_profiles').upsert(profilePayload, { onConflict: 'user_id' }),
    admin.from('user_stats').upsert({ user_id: authUser.id }, { onConflict: 'user_id' }),
    admin.from('sso_identities').upsert(
      {
        provider: tokenPayload.iss,
        external_id: tokenPayload.id,
        email: normalizedEmail,
        user_id: authUser.id,
        display_name: tokenPayload.name,
        last_sign_in_at: new Date().toISOString(),
      },
      { onConflict: 'provider,external_id' }
    ),
  ]);

  if (profileRes.error) {
    throw profileRes.error;
  }

  if (statsRes.error) {
    throw statsRes.error;
  }

  if (identityRes.error) {
    throw identityRes.error;
  }

  return {
    authUser,
    email: normalizedEmail,
  };
}

async function createMagicLink(email, request) {
  const admin = getServiceSupabase();
  const redirectTo = getAuthCallbackUrl(request, { sso: '1' });
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: {
      redirectTo,
    },
  });

  if (error || !data.properties?.action_link) {
    throw error || new Error('Failed to create the BankQuest SSO link.');
  }

  return data.properties.action_link;
}

async function trackActivity(user, action) {
  void user;
  void action;
}

module.exports = {
  createMagicLink,
  getAuthCallbackUrl,
  getAppUrl,
  provisionLocalUser,
  requireVerifiedSSOToken,
  trackActivity,
  verifySSOToken,
};

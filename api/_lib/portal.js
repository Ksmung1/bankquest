const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }

  return value;
}

function getServiceSupabase() {
  return createClient(getEnv('EXPO_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getAuthorizationToken(request) {
  const authorization = request.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new Error('Missing BankQuest session token.');
  }

  return token;
}

async function resolvePortalIdentity(request) {
  const accessToken = getAuthorizationToken(request);
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    throw error || new Error('Invalid BankQuest session.');
  }

  const email = String(data.user.email || '').trim().toLowerCase();
  const externalId = String(data.user.user_metadata?.external_id || '').trim() || null;
  const displayName = String(
    data.user.user_metadata?.full_name ||
      data.user.user_metadata?.name ||
      email.split('@')[0] ||
      'User'
  ).trim();
  const role = String(data.user.user_metadata?.role || 'tester').trim() || 'tester';

  if (!externalId) {
    throw new Error('This BankQuest account is not linked to Website A.');
  }

  return {
    email,
    externalId,
    displayName,
    role,
  };
}

function signPortalEvent(identity, event) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const encodedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const encodedPayload = Buffer.from(
    JSON.stringify({
      iss: 'bankquest',
      aud: 'thanghou-liandou',
      sub: identity.externalId,
      email: identity.email,
      name: identity.displayName,
      role: identity.role,
      iat: issuedAt,
      exp: issuedAt + 60,
      event,
    })
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getEnv('SSO_SHARED_SECRET'))
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

async function forwardPortalEvent(identity, event) {
  const websiteAUrl = getEnv('WEBSITE_A_URL').replace(/\/+$/, '');
  const token = signPortalEvent(identity, event);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(`${websiteAUrl}/api/sso/bankquest/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ok: true }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Website A sync timed out.');
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to sync with Website A.');
  }

  return payload;
}

module.exports = {
  forwardPortalEvent,
  resolvePortalIdentity,
};

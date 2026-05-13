# Auth Guide

This project uses Supabase Auth for email/password authentication. There is no custom auth server in the app codebase. User identity comes from `auth.users`, app profile data is stored in `public.profiles`, and onboarding-specific data is stored in `public.onboarding`.

## 1. Auth entry point

The active auth screen is:

- `app/onboarding-flow.tsx`
- `components/onboarding-restored.tsx`

`app/onboarding-flow.tsx` simply exports `RestoredOnboardingScreen`, so `components/onboarding-restored.tsx` is the live implementation.

The auth UI supports:

- `login` via `supabase.auth.signInWithPassword(...)`
- `signup` via `supabase.auth.signUp(...)`

Form validation done before calling Supabase:

- email must be present and match a basic email regex
- password must be present and at least 8 characters
- first and last name are required only for signup

## 2. Supabase client and session persistence

Supabase is initialized in `lib/supabase.ts`.

Key configuration:

- URL source: `EXPO_PUBLIC_SUPABASE_URL` or Expo `extra.supabaseUrl`
- anon/publishable key source: `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` or Expo `extra.supabasePublishableKey`
- `storage: AsyncStorage` is used outside Node runtime
- `autoRefreshToken: !isNodeRuntime`
- `persistSession: !isNodeRuntime`
- `detectSessionInUrl: false`

What that means:

- on device/web runtime, Supabase persists the auth session locally through `AsyncStorage`
- token refresh is handled by Supabase client automatically in normal app runtime
- server-like/static Node execution avoids `AsyncStorage`
- this app does not rely on URL callback session detection

There is no custom session table in the database schema. Session state is managed by Supabase Auth itself.

## 3. Login flow

In `components/onboarding-restored.tsx`, login runs:

```ts
supabase.auth.signInWithPassword({
  email: form.email.trim().toLowerCase(),
  password: form.password,
})
```

After successful login:

1. `persistJourneyDraft(selectedPersona)` saves a local onboarding draft to `AsyncStorage`.
2. `saveJourneyRecords(userId, selectedPersona, 'login')` upserts profile/onboarding data in Supabase.
3. `setWelcomeFlag('back', ...)` stores a one-time local welcome marker in `AsyncStorage`.
4. `clearOnboardingDraft()` removes the local onboarding draft.
5. `refreshCurrentProfile()` fetches the signed-in user and profile into the local profile cache.
6. The router redirects to `/upsc-dashboard`.

## 4. Signup flow

In `components/onboarding-restored.tsx`, signup runs:

```ts
supabase.auth.signUp({
  email: form.email.trim().toLowerCase(),
  password: form.password,
  options: {
    data: {
      full_name: fullName,
      onboarding_persona: selectedPersona,
    },
  },
})
```

Important details:

- email is normalized to lowercase before signup
- `full_name` and `onboarding_persona` are stored in Supabase user metadata
- after signup, the app immediately writes related app data through `saveJourneyRecords(...)`

After successful signup:

1. local onboarding draft is saved first
2. Supabase creates the auth user in `auth.users`
3. app data is written to `public.profiles`
4. onboarding data is inserted or updated in `public.onboarding`
5. a one-time local welcome flag is stored

### Email verification behavior

The code explicitly checks:

```ts
if (!data.session) {
  setAuthMode('login');
  setAuthError('Account created. Verify your email, then log in to continue.');
  return;
}
```

This means the app supports Supabase projects where email confirmation is enabled:

- if Supabase returns a session immediately, the user continues directly
- if Supabase does not return a session, the account exists but the user must verify email first and then log in

## 5. What gets saved in the database

### `auth.users`

Managed by Supabase Auth. The app writes this indirectly through `signUp(...)`.

User metadata passed during signup:

- `full_name`
- `onboarding_persona`

### `public.profiles`

Schema from `supabase/schema.sql`:

- `id uuid not null`
- `username text`
- `phone text`
- `full_name text`
- `avatar_url text`
- `exam_year text`
- `target_exam text`
- `expert_level integer default 0`
- `preparation_level text`
- `preferred_optional text`
- `selected_subjects text[] default '{}'`
- `onboarding_completed boolean default false`
- `onboarding_snapshot jsonb`
- `timezone text`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`
- `xp_points integer default 0`

`saveJourneyRecords(...)` upserts this table with:

- `id = userId`
- `full_name`
- `exam_key`
- `exam_year`
- `target_exam`
- `expert_level`
- `preparation_level`
- `selected_subjects = []`
- `onboarding_completed = true`
- `onboarding_snapshot`
- `updated_at`

`onboarding_snapshot` is a JSON payload containing:

- persona identity and label
- attempt number
- preparation level
- expert level
- auth mode used (`login` or `signup`)
- normalized auth email
- timestamps for capture
- `journeyStage = 'onboarding_auth_complete'`

### `public.onboarding`

Schema from `supabase/schema.sql`:

- `id uuid default uuid_generate_v4()`
- `user_id uuid`
- `exam_target_year integer`
- `attempt_number integer`
- `preparation_stage text`
- `strengths jsonb`
- `weak_areas jsonb`
- `study_hours_per_day integer`
- `created_at timestamptz default now()`

`saveJourneyRecords(...)` first checks whether an onboarding row already exists for the user:

- if found, it updates that row
- if not found, it inserts a new row

Stored onboarding payload:

- `user_id`
- `exam_target_year`
- `attempt_number`
- `preparation_stage`
- `strengths`
- `weak_areas`
- `study_hours_per_day`

## 6. Database relationships and access control

From `supabase/schema.sql`:

- `public.profiles.id` has a foreign key to `auth.users.id` with `ON DELETE CASCADE`

This is important:

- app profile rows are tied directly to the Supabase auth user id
- deleting the auth user removes the linked profile row automatically

RLS-related policies on `public.profiles`:

- insert: `auth.uid() = id`
- select: `auth.uid() = id`
- update: `auth.uid() = id`

So each authenticated user can only insert/read/update their own profile row.

Several other feature tables also use `auth.uid() = user_id` patterns, so most user-owned data depends on the current Supabase session.

## 7. Local onboarding and profile caches

The app stores non-auth app state locally in `lib/storage.ts` and `lib/profile.ts`.

### `lib/storage.ts`

Local keys:

- `northstar:onboarding:draft`
- `northstar:home:mode`
- `northstar:welcome`

`northstar:onboarding:draft` stores:

- `phase`
- `name`
- `examYear`
- `target`
- `expertLevel`
- `selectedSubjects`
- `analysisCompleted`
- `updatedAt`

This is not the auth session. It is only app-side onboarding progress.

### `lib/profile.ts`

This file maintains a cached current profile object derived from:

- `supabase.auth.getUser()`
- `public.profiles`

Cache key:

- `northstar:profile:current`

The cached object includes:

- authenticated `user`
- matching `profile`
- derived `displayName`
- email
- exam label
- resolved avatar URL

`refreshCurrentProfile()` is the main sync point after auth succeeds.

## 8. How session state is detected in the app

### Initial route decision

`app/index.tsx` runs:

- `supabase.auth.getSession()`
- `getOnboardingDraft()`

If `sessionData.session?.user?.id` exists, the app redirects to:

- `/upsc-dashboard`

Otherwise it goes to:

- `/onboarding-flow`

So the top-level auth gate is session-based and uses Supabase client session state.

### Global auth state reaction

`components/persistent-chrome.tsx` subscribes to:

```ts
supabase.auth.onAuthStateChange((_event, session) => {
  if (!session?.user?.id) {
    void clearCurrentProfileCache();
    return;
  }

  void refreshCurrentProfile().catch(() => null);
});
```

Effectively:

- when a valid session exists, the app refreshes the current profile cache
- when the session disappears, it clears the cached current profile

That keeps UI state aligned with Supabase auth state.

## 9. How sign-out is handled

In `components/persistent-chrome.tsx`, logout runs:

```ts
await supabase.auth.signOut();
router.replace('/onboarding-flow');
```

After sign-out:

- Supabase removes the local session
- the auth state listener clears cached profile data
- the router sends the user back to the onboarding/auth screen

There is no separate custom logout backend flow.

## 10. How protected data uses the session

Across the codebase, authenticated features usually call:

- `supabase.auth.getUser()`
- sometimes `supabase.auth.getSession()`

Examples include:

- profile loading
- topic progress
- flashcard progress
- saved items
- learning metrics
- daily task progress
- mentor chat token forwarding

This means feature writes/reads typically depend on the current authenticated Supabase user id.

## 11. Edge function auth handling

The Supabase Edge Function at `supabase/functions/mentor-chat/index.ts` validates the caller by forwarding the `Authorization` header into a new Supabase client and then calling:

```ts
client.auth.getUser()
```

So for that function:

- the mobile/web app obtains the current session access token
- the token is sent as `Authorization: Bearer <token>`
- the function resolves the user from that token before serving the request

This is the correct pattern for server-side verification of the current session.

## 12. Current auth model summary

In practical terms, the auth system works like this:

1. user signs up or logs in through Supabase email/password auth
2. Supabase owns the real auth identity and session
3. app-specific user data is stored in `public.profiles`
4. onboarding-specific structured setup is stored in `public.onboarding`
5. the session is persisted locally by Supabase using `AsyncStorage`
6. app boot checks `supabase.auth.getSession()` to decide whether to route to dashboard or onboarding
7. UI cache is synchronized through `onAuthStateChange(...)` plus `refreshCurrentProfile()`

## 13. Important implementation notes

- The app currently defaults `selectedPersona` to `'custom'` in `components/onboarding-restored.tsx`, so persona-specific writes always use that value unless the screen is later extended to make it selectable again.
- `public.onboarding` stores `created_at` but the current schema excerpt does not show an `updated_at` column, so updates change the record content without a dedicated updated timestamp.
- The app writes profile rows with `upsert(..., { onConflict: 'id' })`, so repeated login/signup completion can refresh the same row instead of creating duplicates.
- The local onboarding draft is separate from authentication and can exist without a signed-in session.

## 14. Files to check when changing auth

- `lib/supabase.ts`
- `app/index.tsx`
- `app/onboarding-flow.tsx`
- `components/onboarding-restored.tsx`
- `components/persistent-chrome.tsx`
- `lib/profile.ts`
- `lib/storage.ts`
- `supabase/schema.sql`
- `supabase/functions/mentor-chat/index.ts`

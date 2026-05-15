const { createMagicLink, getAuthCallbackUrl, provisionLocalUser, requireVerifiedSSOToken, trackActivity } = require('./_lib/sso');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const payload = requireVerifiedSSOToken(req);
    const provisioned = await provisionLocalUser(payload);
    await trackActivity(provisioned.authUser, {
      type: 'project_login',
      projectName: 'Bank & SSC',
      message: 'Logged in through the Thanghou project portal.',
    });

    const actionLink = await createMagicLink(provisioned.email, req);
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, actionLink);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to complete the SSO login.';
    res.redirect(302, getAuthCallbackUrl(req, { sso_error: message }));
  }
};

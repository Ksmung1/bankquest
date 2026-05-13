const { forwardPortalEvent, resolvePortalIdentity } = require('../_lib/portal');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const identity = await resolvePortalIdentity(req);
    const { reportType, quality, headline, message, projectName } = req.body || {};

    if (!projectName || !reportType || !message) {
      res.status(400).json({ error: 'Project, report type, and message are required.' });
      return;
    }

    const payload = await forwardPortalEvent(identity, {
      type: 'report_submitted',
      projectName: String(projectName),
      reportType: String(reportType),
      quality: typeof quality === 'string' ? quality : 'Useful',
      headline: typeof headline === 'string' ? headline : '',
      message: String(message),
    });

    res.status(200).json(payload);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to submit report.',
    });
  }
};

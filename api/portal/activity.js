const { forwardPortalEvent, resolvePortalIdentity } = require('../_lib/portal');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const identity = await resolvePortalIdentity(req);
    const {
      projectName,
      testId,
      testTitle,
      scoreTotal,
      attemptedTotal,
      totalQuestions,
      timeSpentSeconds,
    } = req.body || {};

    if (!projectName || !testId || !testTitle) {
      res.status(400).json({ error: 'Incomplete activity payload.' });
      return;
    }

    const payload = await forwardPortalEvent(identity, {
      type: 'mock_test_completed',
      projectName: String(projectName),
      testId: String(testId),
      testTitle: String(testTitle),
      scoreTotal: Number(scoreTotal ?? 0),
      attemptedTotal: Number(attemptedTotal ?? 0),
      totalQuestions: Number(totalQuestions ?? 0),
      timeSpentSeconds: Number(timeSpentSeconds ?? 0),
    });

    res.status(200).json(payload);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to sync activity.',
    });
  }
};

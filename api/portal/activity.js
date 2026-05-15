const { forwardPortalEvent, resolvePortalIdentity } = require('../_lib/portal');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const identity = await resolvePortalIdentity(req);
    const body = req.body || {};
    const type = typeof body.type === 'string' ? body.type : '';
    const projectName = typeof body.projectName === 'string' ? body.projectName : '';

    if (!projectName || !type) {
      res.status(400).json({ error: 'Incomplete activity payload.' });
      return;
    }

    let event;

    if (type === 'mock_test_completed') {
      if (!body.testId || !body.testTitle || !body.attemptId) {
        res.status(400).json({ error: 'Incomplete mock activity payload.' });
        return;
      }

      event = {
        type,
        projectName,
        attemptId: String(body.attemptId),
        testId: String(body.testId),
        testTitle: String(body.testTitle),
        scoreTotal: Number(body.scoreTotal ?? 0),
        attemptedTotal: Number(body.attemptedTotal ?? 0),
        totalQuestions: Number(body.totalQuestions ?? 0),
        timeSpentSeconds: Number(body.timeSpentSeconds ?? 0),
      };
    } else if (type === 'project_login') {
      event = {
        type,
        projectName,
        message: typeof body.message === 'string' ? body.message : '',
      };
    } else if (type === 'rank_unlocked') {
      if (!body.rankKey || !body.rankLabel) {
        res.status(400).json({ error: 'Incomplete rank activity payload.' });
        return;
      }

      event = {
        type,
        projectName,
        rankKey: String(body.rankKey),
        rankLabel: String(body.rankLabel),
        averageScore: Number(body.averageScore ?? 0),
      };
    } else if (type === 'card_collected') {
      if (!body.cardKey || !body.cardLabel) {
        res.status(400).json({ error: 'Incomplete card activity payload.' });
        return;
      }

      event = {
        type,
        projectName,
        cardKey: String(body.cardKey),
        cardLabel: String(body.cardLabel),
      };
    } else {
      res.status(400).json({ error: 'Unsupported activity type.' });
      return;
    }

    const payload = await forwardPortalEvent(identity, event);

    res.status(200).json(payload);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to sync activity.',
    });
  }
};

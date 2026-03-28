const { Router } = require('express');
const { getDb } = require('../../db/connection');

const router = Router();

router.get('/', (_req, res) => {
  let dbOk = false;
  try {
    const row = getDb().prepare("SELECT 1 AS ok").get();
    dbOk = row?.ok === 1;
  } catch { /* db unreachable */ }

  const status = dbOk ? 'healthy' : 'degraded';
  const code = dbOk ? 200 : 503;

  res.status(code).json({
    status,
    timestamp: new Date().toISOString(),
    db: dbOk ? 'connected' : 'unreachable',
  });
});

module.exports = router;

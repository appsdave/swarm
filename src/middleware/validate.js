function createError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

function requireFields(fields) {
  return (req, _res, next) => {
    const missing = fields.filter((f) => req.body[f] == null || req.body[f] === '');
    if (missing.length) {
      return next(createError(400, `Missing required fields: ${missing.join(', ')}`));
    }
    next();
  };
}

module.exports = { createError, requireFields };

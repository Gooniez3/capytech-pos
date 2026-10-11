const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-only-secret';
const { requireAuth } = require('./auth');

function run(token) {
  const req = {
    headers: token === undefined
      ? {}
      : { authorization: `Bearer ${token}` },
  };
  let response;
  let nextCalled = false;
  const res = {
    status(status) {
      response = { status };
      return this;
    },
    json(body) {
      response.body = body;
      return this;
    },
  };

  requireAuth(req, res, () => {
    nextCalled = true;
  });

  return { req, response, nextCalled };
}

test('valid JWT reaches the protected route', () => {
  const token = jwt.sign(
    { id: 1, username: 'owner', role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  const result = run(token);
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.user.id, 1);
});

test('expired JWT receives a machine-readable friendly response', () => {
  const token = jwt.sign(
    { id: 1, username: 'owner', role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: -1 }
  );
  const result = run(token);
  assert.equal(result.response.status, 401);
  assert.equal(result.response.body.code, 'AUTH_TOKEN_EXPIRED');
  assert.match(result.response.body.error, /session expired/i);
});

test('malformed and missing JWTs fail closed', () => {
  assert.equal(run('not-a-token').response.body.code, 'AUTH_TOKEN_INVALID');
  assert.equal(run().response.body.code, 'AUTH_TOKEN_MISSING');
});

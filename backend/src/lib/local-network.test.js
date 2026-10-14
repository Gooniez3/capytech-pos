const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedLocalOrigin, isPrivateIPv4 } = require('./local-network');

test('loopback Vite origins are allowed', () => {
  assert.equal(isAllowedLocalOrigin('http://localhost:5173'), true);
  assert.equal(isAllowedLocalOrigin('https://127.0.0.1:5173'), true);
  assert.equal(isAllowedLocalOrigin('https://localhost:5174'), true);
  assert.equal(isAllowedLocalOrigin('http://127.0.0.1:4001'), true);
});

test('private LAN Vite origins are allowed', () => {
  assert.equal(isAllowedLocalOrigin('https://192.168.1.10:5173'), true);
  assert.equal(isAllowedLocalOrigin('https://192.168.1.10:5174'), true);
  assert.equal(isAllowedLocalOrigin('http://10.0.0.8:3000'), true);
  assert.equal(isAllowedLocalOrigin('https://172.16.4.2:5173'), true);
});

test('public and unknown origins are rejected', () => {
  assert.equal(isAllowedLocalOrigin('https://example.com'), false);
  assert.equal(isAllowedLocalOrigin('https://8.8.8.8:5173'), false);
  assert.equal(isAllowedLocalOrigin('https://192.168.1.10:9999'), false);
  assert.equal(isAllowedLocalOrigin('not a url'), false);
});

test('missing origin is allowed for non-browser clients', () => {
  assert.equal(isAllowedLocalOrigin(undefined), true);
  assert.equal(isAllowedLocalOrigin(''), true);
});

test('private IPv4 ranges', () => {
  assert.equal(isPrivateIPv4('192.168.1.12'), true);
  assert.equal(isPrivateIPv4('10.1.1.1'), true);
  assert.equal(isPrivateIPv4('172.16.0.1'), true);
  assert.equal(isPrivateIPv4('172.31.255.255'), true);
  assert.equal(isPrivateIPv4('172.15.0.1'), false);
  assert.equal(isPrivateIPv4('8.8.8.8'), false);
});

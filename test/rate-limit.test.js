'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../src/rate-limit');

test('rate limiter enforces limits and remains bounded under unique-key floods', () => {
  const check = createRateLimiter({ windowMs: 60000, publicLimit: 2, adminLimit: 1 });
  assert.equal(check('one', false).allowed, true);
  assert.equal(check('one', false).allowed, true);
  assert.equal(check('one', false).allowed, false);
  assert.equal(check('admin', true).allowed, true);
  assert.equal(check('admin', true).allowed, false);
  for (let index = 0; index < 6000; index += 1) assert.equal(check(`unique-${index}`, false).allowed, true);
  assert.equal(check('still-works', false).limit, 2);
});

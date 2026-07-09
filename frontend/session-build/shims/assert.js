function assert(value, message) {
  if (!value) throw new Error(message || 'Assertion failed');
}
assert.ok = assert;
assert.equal = (a, b, m) => assert(a == b, m || `${a} == ${b}`);
assert.strictEqual = (a, b, m) => assert(a === b, m || `${a} === ${b}`);
assert.notEqual = (a, b, m) => assert(a != b, m);
assert.deepEqual = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), m);
assert.fail = m => assert(false, m);
module.exports = assert;
module.exports.default = assert;

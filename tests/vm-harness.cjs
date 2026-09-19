const assert = require('node:assert/strict');
const { TOOL_SCHEMAS } = require('../server/agents/vm-harness');
const { TOOLS } = require('../server/agents/tools');
const { isConfigured, MODEL_DEFAULT } = require('../server/gemini');

assert.equal(MODEL_DEFAULT.includes('gemini'), true);
assert.ok(Array.isArray(TOOL_SCHEMAS));
assert.ok(TOOL_SCHEMAS.some((t) => t.name === 'web_search'));
assert.ok(TOOL_SCHEMAS.some((t) => t.name === 'browser_open'));
assert.ok(TOOL_SCHEMAS.some((t) => t.name === 'code_run'));
assert.ok(TOOL_SCHEMAS.some((t) => t.name === 'shell'));
assert.ok(TOOL_SCHEMAS.some((t) => t.name === 'computer_screenshot'));
assert.equal(TOOLS.code_run.approval, false);
assert.equal(TOOLS.trigger_create.approval, true);
assert.equal(TOOLS.composio_execute.approval, true);
assert.ok(isConfigured() === true || isConfigured() === false);
console.log('vm-harness schemas: ok');

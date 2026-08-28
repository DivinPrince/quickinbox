import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDeviceActivity } from './device-activity';

test('formats missing activity as never used', () => {
	assert.equal(formatDeviceActivity(null), 'Never used');
});

test('reports malformed activity timestamps', () => {
	assert.equal(formatDeviceActivity('not-a-timestamp'), 'Activity unavailable');
});

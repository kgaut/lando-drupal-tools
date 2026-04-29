'use strict';

const assert = require('assert');
const buildTooling = require('../lib/tooling');

// ── Helpers ───────────────────────────────────────────────────────────────────

function minimalConfig(overrides = {}) {
  return Object.assign({ local_db_path: 'db', local_tmp_path: 'files/tmp' }, overrides);
}

function withProd(extra = {}) {
  return minimalConfig({
    prod: Object.assign({
      user: 'deploy',
      host: 'prod.example.com',
      path: '/var/www/site',
    }, extra),
  });
}

function withPreprod(extra = {}) {
  return minimalConfig({
    preprod: Object.assign({
      user: 'deploy',
      host: 'preprod.example.com',
      path: '/var/www/site-preprod',
    }, extra),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗  ${name}`);
    console.log(`     ${e.message}`);
    failed++;
  }
}

// Local commands always present
const localCmds = ['db-dump', 'db-empty', 'db-import', 'db-import-only', 'db-deploy',
  'dd-tail', 'watchdog', 'sapi', 'phpcs', 'phpstan', 'phpunit'];

const prodCmds   = ['db-prod-dump', 'db-prod-get', 'db-prod-send', 'db-prod-import', 'ssh-prod'];
const preprodCmds = ['db-preprod-dump', 'db-preprod-get', 'db-preprod-send', 'db-preprod-import', 'ssh-preprod'];

console.log('\nLocal commands\n──────────────');

const base = buildTooling(minimalConfig());

localCmds.forEach(cmd => {
  test(`registers ${cmd}`, () => {
    assert.ok(base[cmd], `missing command: ${cmd}`);
    assert.ok(base[cmd].service, `missing service for: ${cmd}`);
    assert.ok(base[cmd].cmd, `missing cmd for: ${cmd}`);
    assert.ok(base[cmd].description, `missing description for: ${cmd}`);
  });
});

test('db-dump uses correct db path', () => {
  const t = buildTooling(minimalConfig({ local_db_path: 'dumps' }));
  assert.ok(t['db-dump'].cmd.includes('/app/dumps'), 'path mismatch');
});

test('db-import uses correct db path', () => {
  const t = buildTooling(minimalConfig({ local_db_path: 'dumps' }));
  assert.ok(t['db-import'].cmd.includes('/app/dumps'), 'path mismatch');
});

test('dd-tail uses correct tmp path', () => {
  const t = buildTooling(minimalConfig({ local_tmp_path: 'web/sites/default/files/tmp' }));
  assert.ok(t['dd-tail'].cmd.includes('/app/web/sites/default/files/tmp'), 'tmp path mismatch');
});

console.log('\nRemote commands – prod absent\n─────────────────────────────');

prodCmds.forEach(cmd => {
  test(`no ${cmd} without prod config`, () => {
    assert.ok(!base[cmd], `command should not exist: ${cmd}`);
  });
});

preprodCmds.forEach(cmd => {
  test(`no ${cmd} without preprod config`, () => {
    assert.ok(!base[cmd], `command should not exist: ${cmd}`);
  });
});

console.log('\nRemote commands – prod present\n──────────────────────────────');

const withProdTooling = buildTooling(withProd());

prodCmds.forEach(cmd => {
  test(`registers ${cmd}`, () => {
    assert.ok(withProdTooling[cmd], `missing command: ${cmd}`);
    assert.ok(withProdTooling[cmd].cmd, `missing cmd for: ${cmd}`);
  });
});

test('prod commands use correct host', () => {
  assert.ok(withProdTooling['db-prod-get'].cmd.includes('prod.example.com'), 'host mismatch');
});

test('prod commands use default port 22', () => {
  assert.ok(withProdTooling['db-prod-get'].cmd.includes('-p 22'), 'port mismatch');
});

test('prod commands use custom port', () => {
  const t = buildTooling(withProd({ port: 2222 }));
  assert.ok(t['db-prod-get'].cmd.includes('-p 2222'), 'custom port mismatch');
});

test('prod commands use default drush path', () => {
  assert.ok(withProdTooling['db-prod-dump'].cmd.includes('vendor/bin/drush'), 'drush path mismatch');
});

test('prod commands use custom drush path', () => {
  const t = buildTooling(withProd({ drush: '~/drush' }));
  assert.ok(t['db-prod-dump'].cmd.includes('~/drush'), 'custom drush mismatch');
});

test('prod-import includes deploy', () => {
  assert.ok(withProdTooling['db-prod-import'].cmd.includes('drush deploy'), 'deploy missing');
  assert.ok(withProdTooling['db-prod-import'].cmd.includes('drush uli'), 'uli missing');
});

console.log('\nRemote commands – preprod present\n─────────────────────────────────');

const withPreprodTooling = buildTooling(withPreprod());

preprodCmds.forEach(cmd => {
  test(`registers ${cmd}`, () => {
    assert.ok(withPreprodTooling[cmd], `missing command: ${cmd}`);
  });
});

test('preprod commands use correct host', () => {
  assert.ok(withPreprodTooling['db-preprod-get'].cmd.includes('preprod.example.com'), 'host mismatch');
});

console.log('\nUser tooling overrides plugin tooling\n──────────────────────────────────────');

test('user-defined db-dump takes precedence', () => {
  // Simulate what index.js does: plugin tooling merged first, user tooling wins
  const pluginTooling = buildTooling(minimalConfig());
  const userTooling = { 'db-dump': { service: 'appserver', cmd: 'custom-cmd' } };
  const merged = Object.assign({}, pluginTooling, userTooling);
  assert.strictEqual(merged['db-dump'].cmd, 'custom-cmd', 'user tooling did not win');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

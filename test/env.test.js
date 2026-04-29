'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseEnvFile, configFromEnv, deepMerge } = require('../lib/env');

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeTmp(content) {
  const file = path.join(os.tmpdir(), `ldt-test-${process.pid}-${Date.now()}.env`);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

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

// ── parseEnvFile ──────────────────────────────────────────────────────────────

console.log('\nparseEnvFile\n────────────');

test('returns empty object for non-existent file', () => {
  const result = parseEnvFile('/this/file/does/not/exist.env');
  assert.deepStrictEqual(result, {});
});

test('parses simple KEY=value', () => {
  const f = writeTmp('FOO=bar\nBAZ=qux\n');
  const r = parseEnvFile(f);
  assert.strictEqual(r.FOO, 'bar');
  assert.strictEqual(r.BAZ, 'qux');
});

test('strips double-quoted values', () => {
  const f = writeTmp('FOO="hello world"\n');
  assert.strictEqual(parseEnvFile(f).FOO, 'hello world');
});

test('strips single-quoted values', () => {
  const f = writeTmp("FOO='hello world'\n");
  assert.strictEqual(parseEnvFile(f).FOO, 'hello world');
});

test('ignores comment lines', () => {
  const f = writeTmp('# this is a comment\nFOO=bar\n');
  const r = parseEnvFile(f);
  assert.ok(!r['# this is a comment']);
  assert.strictEqual(r.FOO, 'bar');
});

test('ignores blank lines', () => {
  const f = writeTmp('\n\nFOO=bar\n\n');
  assert.strictEqual(parseEnvFile(f).FOO, 'bar');
});

test('ignores lowercase keys (env vars are uppercase)', () => {
  const f = writeTmp('foo=bar\nFOO=baz\n');
  const r = parseEnvFile(f);
  assert.ok(!r.foo, 'lowercase key should be ignored');
  assert.strictEqual(r.FOO, 'baz');
});

test('handles values containing = signs', () => {
  const f = writeTmp('DSN=mysql://user:pass@host/db?foo=bar\n');
  assert.strictEqual(parseEnvFile(f).DSN, 'mysql://user:pass@host/db?foo=bar');
});

// ── configFromEnv ─────────────────────────────────────────────────────────────

console.log('\nconfigFromEnv\n─────────────');

test('returns empty config when no relevant vars', () => {
  assert.deepStrictEqual(configFromEnv({}), {});
});

test('maps LOCAL_DB_PATH', () => {
  const c = configFromEnv({ LOCAL_DB_PATH: 'db' });
  assert.strictEqual(c.local_db_path, 'db');
});

test('strips leading ./ from LOCAL_DB_PATH', () => {
  const c = configFromEnv({ LOCAL_DB_PATH: './db' });
  assert.strictEqual(c.local_db_path, 'db');
});

test('strips leading ./ from LOCAL_TMP_PATH', () => {
  const c = configFromEnv({ LOCAL_TMP_PATH: './files/tmp' });
  assert.strictEqual(c.local_tmp_path, 'files/tmp');
});

test('maps PROD_* vars to config.prod', () => {
  const c = configFromEnv({
    PROD_USER: 'deploy',
    PROD_HOST: 'prod.example.com',
    PROD_PATH: '/var/www/site',
    PROD_PORT: '2222',
    PROD_DRUSH: '~/drush',
    PROD_URL: 'example.com',
    PROD_DB_PATH: 'dumps',
  });
  assert.strictEqual(c.prod.user,    'deploy');
  assert.strictEqual(c.prod.host,    'prod.example.com');
  assert.strictEqual(c.prod.path,    '/var/www/site');
  assert.strictEqual(c.prod.port,    2222);
  assert.strictEqual(c.prod.drush,   '~/drush');
  assert.strictEqual(c.prod.url,     'example.com');
  assert.strictEqual(c.prod.db_path, 'dumps');
});

test('maps PREPROD_* vars to config.preprod', () => {
  const c = configFromEnv({
    PREPROD_USER: 'deploy',
    PREPROD_HOST: 'preprod.example.com',
    PREPROD_PATH: '/var/www/site-preprod',
  });
  assert.strictEqual(c.preprod.user, 'deploy');
  assert.strictEqual(c.preprod.host, 'preprod.example.com');
});

test('does not create config.prod when no PROD vars present', () => {
  const c = configFromEnv({ LOCAL_DB_PATH: 'db' });
  assert.ok(!c.prod, 'config.prod should not exist');
});

test('PROD_PORT is parsed as integer', () => {
  const c = configFromEnv({ PROD_USER: 'u', PROD_HOST: 'h', PROD_PATH: '/p', PROD_PORT: '2222' });
  assert.strictEqual(typeof c.prod.port, 'number');
  assert.strictEqual(c.prod.port, 2222);
});

// ── deepMerge ─────────────────────────────────────────────────────────────────

console.log('\ndeepMerge\n─────────');

test('override wins for scalar values', () => {
  const result = deepMerge({ a: 1 }, { a: 2 });
  assert.strictEqual(result.a, 2);
});

test('base values preserved when not in override', () => {
  const result = deepMerge({ a: 1, b: 2 }, { a: 9 });
  assert.strictEqual(result.b, 2);
});

test('nested objects merged recursively', () => {
  const result = deepMerge(
    { prod: { user: 'env-user', host: 'env-host' } },
    { prod: { host: 'yaml-host' } }
  );
  assert.strictEqual(result.prod.user, 'env-user');   // from base (.env)
  assert.strictEqual(result.prod.host, 'yaml-host');  // overridden by .lando.yml
});

test('.lando.yml value overrides .env for same key', () => {
  const envConfig  = configFromEnv({ PROD_USER: 'env-user', PROD_HOST: 'env-host', PROD_PATH: '/p' });
  const yamlConfig = { prod: { user: 'yaml-user' } };
  const merged = deepMerge(envConfig, yamlConfig);
  assert.strictEqual(merged.prod.user, 'yaml-user');  // .lando.yml wins
  assert.strictEqual(merged.prod.host, 'env-host');   // .env fallback
});

test('.env provides complete config when .lando.yml has none', () => {
  const envConfig  = configFromEnv({
    LOCAL_DB_PATH: 'db',
    PROD_USER: 'deploy',
    PROD_HOST: 'prod.example.com',
    PROD_PATH: '/var/www/site',
  });
  const merged = deepMerge(envConfig, {});
  assert.strictEqual(merged.local_db_path, 'db');
  assert.strictEqual(merged.prod.user, 'deploy');
});

test('does not mutate base or override objects', () => {
  const base     = { prod: { user: 'a' } };
  const override = { prod: { user: 'b' } };
  deepMerge(base, override);
  assert.strictEqual(base.prod.user, 'a');
  assert.strictEqual(override.prod.user, 'b');
});

// ── Integration: .env file → tooling commands ─────────────────────────────────

console.log('\nIntegration: .env → tooling\n────────────────────────────');

const buildTooling = require('../lib/tooling');

test('tooling built from .env config registers prod commands', () => {
  const envVars = parseEnvFile(writeTmp([
    'LOCAL_DB_PATH=db',
    'PROD_USER=deploy',
    'PROD_HOST=prod.example.com',
    'PROD_PATH=/var/www/site',
    'PROD_URL=example.com',
  ].join('\n')));
  const config = configFromEnv(envVars);
  const tooling = buildTooling(config);
  assert.ok(tooling['db-prod-get'],    'db-prod-get missing');
  assert.ok(tooling['db-prod-import'], 'db-prod-import missing');
  assert.ok(tooling['ssh-prod'],       'ssh-prod missing');
  assert.ok(tooling['db-prod-get'].cmd.includes('prod.example.com'), 'host not in cmd');
});

test('.lando.yml overrides .env for a specific remote key', () => {
  const envVars = parseEnvFile(writeTmp([
    'PROD_USER=env-user',
    'PROD_HOST=env-host.com',
    'PROD_PATH=/env/path',
  ].join('\n')));
  const envConfig  = configFromEnv(envVars);
  const yamlConfig = { prod: { host: 'yaml-host.com' } };
  const config = deepMerge(envConfig, yamlConfig);
  const tooling = buildTooling(config);
  assert.ok(tooling['db-prod-get'].cmd.includes('yaml-host.com'), 'yaml host not used');
  assert.ok(!tooling['db-prod-get'].cmd.includes('env-host.com'), 'env host should be overridden');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

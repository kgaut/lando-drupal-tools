'use strict';

const fs = require('fs');

/**
 * Parses a .env file and returns a plain object of key/value pairs.
 * Handles quoted values and ignores comments and blank lines.
 *
 * @param {string} filePath - Absolute path to the .env file.
 * @returns {Object}
 */
function parseEnvFile(filePath) {
  const vars = {};
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return vars;
  }

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;

    let value = line.slice(eqIdx + 1).trim();

    // Strip surrounding single or double quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    vars[key] = value;
  }

  return vars;
}

/**
 * Maps the .env variables from the original drupal-makefile convention to the
 * drupal_tools config structure used by this plugin.
 *
 * Variable names (same as the Makefile):
 *   LOCAL_DB_PATH, LOCAL_TMP_PATH
 *   PROD_USER, PROD_HOST, PROD_PORT, PROD_PATH, PROD_DRUSH, PROD_URL, PROD_DB_PATH
 *   PREPROD_USER, PREPROD_HOST, PREPROD_PORT, PREPROD_PATH, PREPROD_DRUSH, PREPROD_URL, PREPROD_DB_PATH
 *
 * @param {Object} env - Key/value pairs from parseEnvFile().
 * @returns {Object}   - Partial drupal_tools config derived from .env.
 */
function configFromEnv(env) {
  const config = {};

  if (env.LOCAL_DB_PATH) {
    // Strip leading "./" that was common in the original Makefile
    config.local_db_path = env.LOCAL_DB_PATH.replace(/^\.\//, '');
  }
  if (env.LOCAL_TMP_PATH) {
    config.local_tmp_path = env.LOCAL_TMP_PATH.replace(/^\.\//, '');
  }

  const buildRemote = prefix => {
    const user = env[`${prefix}_USER`];
    const host = env[`${prefix}_HOST`];
    const envPath = env[`${prefix}_PATH`];
    if (!user && !host && !envPath) return null;

    const remote = {};
    if (user)                       remote.user    = user;
    if (host)                       remote.host    = host;
    if (env[`${prefix}_PORT`])      remote.port    = parseInt(env[`${prefix}_PORT`], 10);
    if (envPath)                    remote.path    = envPath;
    if (env[`${prefix}_DRUSH`])     remote.drush   = env[`${prefix}_DRUSH`];
    if (env[`${prefix}_URL`])       remote.url     = env[`${prefix}_URL`];
    if (env[`${prefix}_DB_PATH`])   remote.db_path = env[`${prefix}_DB_PATH`];
    return remote;
  };

  const prod = buildRemote('PROD');
  if (prod) config.prod = prod;

  const preprod = buildRemote('PREPROD');
  if (preprod) config.preprod = preprod;

  return config;
}

/**
 * Deep-merges two plain objects. Values in `override` take precedence.
 * Nested objects are merged recursively; other types are replaced.
 *
 * @param {Object} base
 * @param {Object} override
 * @returns {Object}
 */
function deepMerge(base, override) {
  const result = Object.assign({}, base);
  for (const key of Object.keys(override || {})) {
    const val = override[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = deepMerge(result[key] || {}, val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

module.exports = { parseEnvFile, configFromEnv, deepMerge };

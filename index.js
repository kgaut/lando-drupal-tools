'use strict';

const path = require('path');
const buildTooling = require('./lib/tooling');
const { parseEnvFile, configFromEnv, deepMerge } = require('./lib/env');

/**
 * Lando plugin: lando-drupal-tools
 *
 * Configuration priority (highest → lowest):
 *   1. drupal_tools block in .lando.yml
 *   2. Environment variables from the project's .env file
 *      (same variable names as kgaut/drupal-makefile)
 *
 * The plugin activates when either source provides enough config to be useful.
 */
module.exports = (app, lando) => {
  // Parse .env from the project root and build a base config from it
  const envVars = parseEnvFile(path.join(app.root, '.env'));
  const envConfig = configFromEnv(envVars);

  // .lando.yml drupal_tools is merged on top: its values always win
  const yamlConfig = (app.config && app.config.drupal_tools) || {};
  const config = deepMerge(envConfig, yamlConfig);

  // Activate only when there is something meaningful to work with
  const hasConfig =
    Object.keys(yamlConfig).length > 0 ||
    config.local_db_path ||
    (config.prod    && config.prod.user    && config.prod.host) ||
    (config.preprod && config.preprod.user && config.preprod.host);

  if (!hasConfig) return;

  app.events.on('pre-init', () => {
    const tooling = buildTooling(config);

    // Merge our tooling first so that user-defined tooling in .lando.yml takes precedence
    app.config.tooling = Object.assign({}, tooling, app.config.tooling || {});

    lando.log.verbose(
      'lando-drupal-tools: registered %d commands (config sources: %s)',
      Object.keys(tooling).length,
      [Object.keys(envConfig).length > 0 && '.env', Object.keys(yamlConfig).length > 0 && '.lando.yml']
        .filter(Boolean).join(', ') || 'none'
    );
  });
};

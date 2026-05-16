'use strict';

const path = require('path');
const buildTooling = require('./lib/tooling');
const { parseEnvFile, configFromEnv, deepMerge } = require('./lib/env');

/**
 * Lando global plugin hook for lando-drupal-tools.
 *
 * Tooling must be injected via lando.appConfig in the post-bootstrap-app event
 * because app.js is called after the task list is already built from appConfig.
 */
module.exports = lando => {
  lando.events.on('post-bootstrap-app', lando2 => {
    const ac = lando2.appConfig;
    if (!ac) return;

    const envVars = parseEnvFile(path.join(ac.root || process.cwd(), '.env'));
    const envConfig = configFromEnv(envVars);
    const yamlConfig = ac.drupal_tools || {};
    const config = deepMerge(envConfig, yamlConfig);

    const hasConfig =
      Object.keys(yamlConfig).length > 0 ||
      config.local_db_path ||
      (config.prod    && config.prod.user    && config.prod.host) ||
      (config.preprod && config.preprod.user && config.preprod.host);

    if (!hasConfig) return;

    const tooling = buildTooling(config);

    // Merge: our tooling first so that user-defined tooling in .lando.yml takes precedence
    ac.tooling = Object.assign({}, tooling, ac.tooling || {});

    lando.log.verbose(
      'lando-drupal-tools: registered %d commands (config sources: %s)',
      Object.keys(tooling).length,
      [Object.keys(envConfig).length > 0 && '.env', Object.keys(yamlConfig).length > 0 && '.lando.yml / .lando.local.yml']
        .filter(Boolean).join(', ') || 'none'
    );
  });
};

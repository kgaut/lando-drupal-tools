'use strict';

const buildTooling = require('./lib/tooling');

/**
 * Lando plugin: lando-drupal-tools
 *
 * Adds Drupal developer commands to any Lando app that has a `drupal_tools`
 * section in its .lando.yml. Commands for remote environments (prod/preprod)
 * are only registered when the corresponding SSH config is present.
 */
module.exports = (app, lando) => {
  const config = app.config && app.config.drupal_tools;

  if (!config) return;

  app.events.on('pre-init', () => {
    const tooling = buildTooling(config);

    // Merge our tooling first so that user-defined tooling in .lando.yml takes precedence.
    app.config.tooling = Object.assign({}, tooling, app.config.tooling || {});

    lando.log.verbose('lando-drupal-tools: registered %d commands', Object.keys(tooling).length);
  });
};

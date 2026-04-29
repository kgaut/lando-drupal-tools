'use strict';

/**
 * Builds a deploy script string (pre-deploy scripts + drush deploy + post-deploy scripts + uli).
 */
function buildDeployScript() {
  return [
    'if [ -d /app/scripts/pre-deploy ]; then',
    '  for f in /app/scripts/pre-deploy/*; do',
    '    [ -f "$f" ] || continue;',
    '    echo "Running pre-deploy: $f";',
    '    drush php:script "$f" || exit 1;',
    '  done;',
    'fi;',
    'drush deploy;',
    'if [ -d /app/scripts/post-deploy ]; then',
    '  for f in /app/scripts/post-deploy/*; do',
    '    [ -f "$f" ] || continue;',
    '    echo "Running post-deploy: $f";',
    '    drush php:script "$f" || exit 1;',
    '  done;',
    'fi;',
    'drush uli',
  ].join(' ');
}

/**
 * Builds an import script that finds the most recent local dump and imports it.
 *
 * @param {string} containerDbPath - Absolute path to the dump directory inside the container.
 * @param {string} localDbPath     - Relative path shown in error messages.
 * @param {string} postImportCmd   - Command to run after import (e.g. deploy or cr+uli).
 */
function buildImportScript(containerDbPath, localDbPath, postImportCmd) {
  return [
    `set -e;`,
    `DUMP=$(ls -t ${containerDbPath}/*.sql.gz 2>/dev/null | head -1);`,
    `[ -n "$DUMP" ] || { echo "No dump found in ${localDbPath}/"; exit 1; };`,
    `echo "Importing $DUMP...";`,
    `drush sql-drop --yes;`,
    `zcat "$DUMP" | drush sql-cli;`,
    postImportCmd,
  ].join(' ');
}

/**
 * Builds remote-related tooling for a given environment (prod or preprod).
 *
 * @param {Object} env             - Environment config object.
 * @param {string} envName         - 'prod' or 'preprod'.
 * @param {string} containerDbPath - Absolute path to dump dir inside the container.
 * @param {string} localDbPath     - Relative path shown in messages.
 * @param {string} deployScript    - The deploy script string.
 */
function buildRemoteTooling(env, envName, containerDbPath, localDbPath, deployScript) {
  const port = env.port || 22;
  const drush = env.drush || 'vendor/bin/drush';
  const dbPath = env.db_path || 'db';
  const url = env.url || envName;
  const sshOpts = `-p ${port} -o StrictHostKeyChecking=accept-new`;
  const sshBase = `ssh ${sshOpts} ${env.user}@${env.host}`;
  const remoteDbPath = `${env.path}/${dbPath}`;

  const label = envName === 'prod' ? 'production' : 'preproduction';
  const tooling = {};

  tooling[`db-${envName}-dump`] = {
    service: 'appserver',
    description: `Create a gzipped database dump on the ${label} server`,
    cmd: `${sshBase} 'cd ${env.path} && ${drush} sql-dump --structure-tables-key=light --gzip > "${remoteDbPath}/$(date +%Y-%m-%d_%H-%M-%S)-${url}-${envName}-light.sql.gz" && echo "Dump created in ${remoteDbPath}/"'`,
  };

  tooling[`db-${envName}-get`] = {
    service: 'appserver',
    description: `Download the most recent dump from ${label}`,
    cmd: [
      `set -e;`,
      `DUMP=$(${sshBase} 'ls -t ${remoteDbPath}/ 2>/dev/null | grep sql.gz | head -1');`,
      `[ -n "$DUMP" ] || { echo "No dump found on ${label}"; exit 1; };`,
      `echo "Downloading ${remoteDbPath}/$DUMP ...";`,
      `mkdir -p ${containerDbPath};`,
      `scp -P ${port} -o StrictHostKeyChecking=accept-new ${env.user}@${env.host}:${remoteDbPath}/$DUMP ${containerDbPath}/;`,
      `echo "Downloaded to ${localDbPath}/$DUMP"`,
    ].join(' '),
  };

  tooling[`db-${envName}-send`] = {
    service: 'appserver',
    description: `Send the most recent local dump to ${label}`,
    cmd: [
      `set -e;`,
      `DUMP=$(ls -t ${containerDbPath}/*.sql.gz 2>/dev/null | head -1 | xargs -r basename);`,
      `[ -n "$DUMP" ] || { echo "No dump found in ${localDbPath}/"; exit 1; };`,
      `echo "Sending $DUMP to ${label}...";`,
      `scp -P ${port} -o StrictHostKeyChecking=accept-new ${containerDbPath}/$DUMP ${env.user}@${env.host}:${remoteDbPath}/;`,
      `echo "Sent to ${remoteDbPath}/$DUMP"`,
    ].join(' '),
  };

  tooling[`db-${envName}-import`] = {
    service: 'appserver',
    description: `Download the latest ${label} dump and import it locally with drush deploy`,
    cmd: [
      `set -e;`,
      `DUMP=$(${sshBase} 'ls -t ${remoteDbPath}/ 2>/dev/null | grep sql.gz | head -1');`,
      `[ -n "$DUMP" ] || { echo "No dump found on ${label}"; exit 1; };`,
      `echo "Downloading ${remoteDbPath}/$DUMP ...";`,
      `mkdir -p ${containerDbPath};`,
      `scp -P ${port} -o StrictHostKeyChecking=accept-new ${env.user}@${env.host}:${remoteDbPath}/$DUMP ${containerDbPath}/;`,
      `echo "Importing $DUMP...";`,
      `drush sql-drop --yes;`,
      `zcat "${containerDbPath}/$DUMP" | drush sql-cli;`,
      deployScript,
    ].join(' '),
  };

  tooling[`ssh-${envName}`] = {
    service: 'appserver',
    description: `Open an SSH connection to ${label}`,
    cmd: `${sshBase} -t 'cd ${env.path} && exec $SHELL -l'`,
  };

  return tooling;
}

/**
 * Builds the full tooling object for the plugin based on the drupal_tools config.
 *
 * @param {Object} config - The drupal_tools config from .lando.yml.
 */
module.exports = function buildTooling(config) {
  const localDbPath = config.local_db_path || 'db';
  const localTmpPath = config.local_tmp_path || 'files/tmp';
  const containerDbPath = `/app/${localDbPath}`;
  const containerTmpPath = `/app/${localTmpPath}`;

  const deployScript = buildDeployScript();

  const tooling = {};

  // ─── Local database commands ─────────────────────────────────────────────

  tooling['db-dump'] = {
    service: 'appserver',
    description: 'Dump the local database to a gzipped file in the db directory',
    cmd: `bash -c 'mkdir -p ${containerDbPath} && drush sql-dump --gzip --result-file=${containerDbPath}/$(date +%Y-%m-%d_%H-%M-%S)-local.sql && echo "Dump saved in ${localDbPath}/"'`,
  };

  tooling['db-empty'] = {
    service: 'appserver',
    description: 'Drop all tables in the local database (drush sql-drop)',
    cmd: 'drush sql-drop --yes',
  };

  tooling['db-import'] = {
    service: 'appserver',
    description: 'Import the most recent local dump then run drush deploy and generate a login URL',
    cmd: `bash -c '${buildImportScript(containerDbPath, localDbPath, deployScript)}'`,
  };

  tooling['db-import-only'] = {
    service: 'appserver',
    description: 'Import the most recent local dump then run drush cr (no deploy)',
    cmd: `bash -c '${buildImportScript(containerDbPath, localDbPath, 'drush cr; drush uli')}'`,
  };

  tooling['db-deploy'] = {
    service: 'appserver',
    description: 'Run pre-deploy scripts, drush deploy, post-deploy scripts and generate a login URL',
    cmd: `bash -c '${deployScript}'`,
  };

  // ─── Watchdog / debug ─────────────────────────────────────────────────────

  tooling['dd-tail'] = {
    service: 'appserver',
    description: 'Tail the drupal_debug.txt file (kint/dpm output)',
    cmd: `tail -f ${containerTmpPath}/drupal_debug.txt`,
  };

  tooling['watchdog'] = {
    service: 'appserver',
    description: 'Tail Drupal watchdog messages in real time',
    cmd: 'drush watchdog-show --tail --count=50',
  };

  // ─── Search API ───────────────────────────────────────────────────────────

  tooling['sapi'] = {
    service: 'appserver',
    description: 'Reindex all Search API indexes (sapi-r then sapi-i)',
    cmd: 'drush sapi-r && drush sapi-i',
  };

  // ─── Quality tools ────────────────────────────────────────────────────────

  tooling['phpcs'] = {
    service: 'appserver',
    description: 'Run PHP CodeSniffer (pass a path as argument)',
    cmd: 'phpcs --report-full --report-summary --report-source',
  };

  tooling['phpstan'] = {
    service: 'appserver',
    description: 'Run PHPStan static analysis (pass a path as argument)',
    cmd: 'phpstan',
  };

  tooling['phpunit'] = {
    service: 'appserver',
    description: 'Run PHPUnit test suite',
    cmd: 'phpunit --testdox',
  };

  // ─── Remote environments ──────────────────────────────────────────────────

  const prod = config.prod || {};
  if (prod.user && prod.host && prod.path) {
    Object.assign(tooling, buildRemoteTooling(prod, 'prod', containerDbPath, localDbPath, deployScript));
  }

  const preprod = config.preprod || {};
  if (preprod.user && preprod.host && preprod.path) {
    Object.assign(tooling, buildRemoteTooling(preprod, 'preprod', containerDbPath, localDbPath, deployScript));
  }

  return tooling;
};

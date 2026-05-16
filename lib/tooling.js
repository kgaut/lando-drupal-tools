'use strict';

/**
 * Builds a deploy script string (pre-deploy scripts + drush deploy + post-deploy scripts + uli).
 * No single quotes — Lando already wraps cmd in a shell context.
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
 */
function buildImportScript(containerDbPath, localDbPath, postImportCmd) {
  return [
    'set -e;',
    `DUMP=$(ls -t ${containerDbPath}/*.sql.gz 2>/dev/null | head -1);`,
    `[ -n "$DUMP" ] || { echo "No dump found in ${localDbPath}/"; exit 1; };`,
    'echo "Importing $DUMP...";',
    'drush sql-drop --yes;',
    'zcat "$DUMP" | drush sql-cli;',
    postImportCmd,
  ].join(' ');
}

/**
 * Builds remote-related tooling for a given environment.
 * All cmd strings avoid single quotes so they work inside Lando's shell wrapper.
 * Remote scripts are piped via stdin using: printf %s "script" | ssh host bash -s
 */
function buildRemoteTooling(env, envName, containerDbPath, localDbPath, deployScript) {
  const port = env.port || 22;
  const drush = env.drush || 'vendor/bin/drush';
  const dbPath = env.db_path || 'db';
  const url = env.url || envName;
  const sshOpts = `-p ${port} -o StrictHostKeyChecking=accept-new`;
  const sshBase = `ssh ${sshOpts} ${env.user}@${env.host}`;
  const scpBase = `scp -P ${port} -o StrictHostKeyChecking=accept-new`;
  const remoteDbPath = `${env.path}/${dbPath}`;

  const label = envName === 'prod' ? 'production' : 'preproduction';
  const tooling = {};

  // Remote dump filename uses local timestamp (container time — acceptable, just needs to be unique)
  const dumpFilename = `$(date +%Y-%m-%d_%H-%M-%S)-${url}-${envName}-light.sql.gz`;
  const remoteDumpScript = `cd ${env.path} && ${drush} sql-dump --structure-tables-key=light --gzip > ${remoteDbPath}/${dumpFilename} && echo "Dump created in ${remoteDbPath}/"`;

  tooling[`db-${envName}-dump`] = {
    service: 'appserver',
    description: `Create a gzipped database dump on the ${label} server`,
    cmd: `printf %s "${remoteDumpScript}" | ${sshBase} bash -s`,
  };

  const listRemoteDumpsScript = `ls -t ${remoteDbPath}/ 2>/dev/null | grep sql.gz | head -1`;

  tooling[`db-${envName}-get`] = {
    service: 'appserver',
    description: `Download the most recent dump from ${label}`,
    cmd: [
      'set -e;',
      `DUMP=$(printf %s "${listRemoteDumpsScript}" | ${sshBase} bash -s);`,
      `[ -n "$DUMP" ] || { echo "No dump found on ${label}"; exit 1; };`,
      `echo "Downloading ${remoteDbPath}/$DUMP ...";`,
      `mkdir -p ${containerDbPath};`,
      `${scpBase} ${env.user}@${env.host}:${remoteDbPath}/$DUMP ${containerDbPath}/;`,
      'echo "Download complete"',
    ].join(' '),
  };

  tooling[`db-${envName}-send`] = {
    service: 'appserver',
    description: `Send the most recent local dump to ${label}`,
    cmd: [
      'set -e;',
      `DUMP=$(ls -t ${containerDbPath}/*.sql.gz 2>/dev/null | head -1 | xargs -r basename);`,
      `[ -n "$DUMP" ] || { echo "No dump found in ${localDbPath}/"; exit 1; };`,
      `echo "Sending $DUMP to ${label}...";`,
      `${scpBase} ${containerDbPath}/$DUMP ${env.user}@${env.host}:${remoteDbPath}/;`,
      `echo "Sent to ${remoteDbPath}/$DUMP"`,
    ].join(' '),
  };

  tooling[`db-${envName}-import`] = {
    service: 'appserver',
    description: `Download the latest ${label} dump and import it locally with drush deploy`,
    cmd: [
      'set -e;',
      `DUMP=$(printf %s "${listRemoteDumpsScript}" | ${sshBase} bash -s);`,
      `[ -n "$DUMP" ] || { echo "No dump found on ${label}"; exit 1; };`,
      `echo "Downloading ${remoteDbPath}/$DUMP ...";`,
      `mkdir -p ${containerDbPath};`,
      `${scpBase} ${env.user}@${env.host}:${remoteDbPath}/$DUMP ${containerDbPath}/;`,
      'echo "Importing $DUMP...";',
      'drush sql-drop --yes;',
      'zcat "${containerDbPath}/$DUMP" | drush sql-cli;',
      deployScript,
    ].join(' '),
  };

  tooling[`ssh-${envName}`] = {
    service: 'appserver',
    description: `Open an SSH connection to ${label}`,
    cmd: `${sshBase} -t "cd ${env.path}; exec bash -l"`,
  };

  return tooling;
}

/**
 * Builds the full tooling object for the plugin.
 * All cmd strings are free of single quotes to avoid conflicts with Lando's shell wrapper.
 */
module.exports = function buildTooling(config) {
  const localDbPath = config.local_db_path || 'db';
  const localTmpPath = config.local_tmp_path || 'files/tmp';
  const containerDbPath = `/app/${localDbPath}`;
  const containerTmpPath = `/app/${localTmpPath}`;

  const deployScript = buildDeployScript();

  const tooling = {};

  // ─── Local database ───────────────────────────────────────────────────────

  tooling['db-dump'] = {
    service: 'appserver',
    description: 'Dump the local database to a gzipped file in the db directory',
    cmd: `mkdir -p ${containerDbPath} && drush sql-dump --gzip --result-file=${containerDbPath}/$(date +%Y-%m-%d_%H-%M-%S)-local.sql`,
  };

  tooling['db-empty'] = {
    service: 'appserver',
    description: 'Drop all tables in the local database (drush sql-drop)',
    cmd: 'drush sql-drop --yes',
  };

  tooling['db-import'] = {
    service: 'appserver',
    description: 'Import the most recent local dump then run drush deploy and generate a login URL',
    cmd: buildImportScript(containerDbPath, localDbPath, deployScript),
  };

  tooling['db-import-only'] = {
    service: 'appserver',
    description: 'Import the most recent local dump then run drush cr (no deploy)',
    cmd: buildImportScript(containerDbPath, localDbPath, 'drush cr; drush uli'),
  };

  tooling['db-deploy'] = {
    service: 'appserver',
    description: 'Run pre-deploy scripts, drush deploy, post-deploy scripts and generate a login URL',
    cmd: deployScript,
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

# lando-drupal-tools

Lando v3 plugin that adds Drupal developer commands to your project.  
Port of [kgaut/drupal-makefile](https://github.com/kgaut/drupal-makefile) for the Lando ecosystem.

Commands cover local database management, remote environment synchronisation (prod / preprod via SSH/SCP), drush deploy workflows with pre/post scripts, and PHP quality tools.

---

## Installation

### Global (recommended — available for all projects)

```bash
git clone https://github.com/kgaut/lando-drupal-tools.git ~/.lando/plugins/lando-drupal-tools
```

The plugin is automatically loaded for every project that has a `drupal_tools` section in its `.lando.yml`.

### Per-project

If you prefer to ship the plugin with a specific project, add it under the `.lando/plugins/` directory and reference it in `.lando.yml`:

```yaml
# .lando.yml
plugins:
  lando-drupal-tools: /path/to/lando-drupal-tools
```

Or clone it directly into the project's plugin directory:

```bash
mkdir -p .lando/plugins
git clone https://github.com/kgaut/lando-drupal-tools.git .lando/plugins/lando-drupal-tools
```

Then reference it in `.lando.yml`:

```yaml
plugins:
  lando-drupal-tools: ./.lando/plugins/lando-drupal-tools
```

---

## Configuration

Add a `drupal_tools` block to your `.lando.yml`:

```yaml
drupal_tools:
  # Local path (relative to project root) where DB dumps are stored.
  # Default: db
  local_db_path: db

  # Local path to Drupal temporary files (used by dd-tail).
  # Default: files/tmp
  local_tmp_path: web/sites/default/files/tmp

  # ── Production environment ───────────────────────────────────────────
  prod:
    user: my_ssh_user
    host: my-server.example.com
    port: 22                        # optional, default: 22
    path: /var/www/my-website       # composer root (not docroot)
    drush: vendor/bin/drush         # optional, default: vendor/bin/drush
    url: my-website.com             # optional, used in dump filenames
    db_path: db                     # dump folder relative to path, default: db

  # ── Preproduction environment ─────────────────────────────────────────
  preprod:
    user: my_ssh_user_preprod
    host: preprod.my-server.example.com
    port: 22
    path: /var/www/my-website-preprod
    drush: vendor/bin/drush
    url: preprod.my-website.com
    db_path: db
```

Remote commands (`db-prod-*`, `db-preprod-*`, `ssh-prod`, `ssh-preprod`) are only registered when the corresponding environment block has at least `user`, `host`, and `path` set.

---

## SSH keys

Lando mounts your local `~/.ssh` directory into the `appserver` container, so SSH / SCP commands work out of the box.  
On first connection to a remote host you may be asked to confirm the fingerprint; after that it is cached automatically (`StrictHostKeyChecking=accept-new`).

---

## Available commands

### Local database

| Command | Description |
|---------|-------------|
| `lando db-dump` | Dump the local database to a timestamped `.sql.gz` file in `local_db_path/` |
| `lando db-empty` | Drop all local database tables (`drush sql-drop`) |
| `lando db-import` | Import the most recent dump from `local_db_path/`, then run `drush deploy` and print a login URL |
| `lando db-import-only` | Import the most recent dump from `local_db_path/`, then run `drush cr` only (no deploy) |
| `lando db-deploy` | Run pre-deploy scripts, `drush deploy`, post-deploy scripts, and print a login URL |

#### Pre / post deploy scripts

If `scripts/pre-deploy/` or `scripts/post-deploy/` directories exist in your project root, every file inside is executed with `drush php:script` before / after `drush deploy`. Any script failure stops the process.

---

### Production

| Command | Description |
|---------|-------------|
| `lando db-prod-dump` | Create a gzipped dump directly on the production server |
| `lando db-prod-get` | Download the most recent dump from production to `local_db_path/` |
| `lando db-prod-send` | Upload the most recent local dump to production |
| `lando db-prod-import` | Download the most recent production dump and import it locally with deploy |
| `lando ssh-prod` | Open an interactive SSH session to production |

---

### Preproduction

| Command | Description |
|---------|-------------|
| `lando db-preprod-dump` | Create a gzipped dump directly on the preproduction server |
| `lando db-preprod-get` | Download the most recent dump from preproduction to `local_db_path/` |
| `lando db-preprod-send` | Upload the most recent local dump to preproduction |
| `lando db-preprod-import` | Download the most recent preproduction dump and import it locally with deploy |
| `lando ssh-preprod` | Open an interactive SSH session to preproduction |

---

### Debug & monitoring

| Command | Description |
|---------|-------------|
| `lando dd-tail` | Tail `drupal_debug.txt` (Kint / `dpm()` output) |
| `lando watchdog` | Tail Drupal watchdog messages in real time (`drush watchdog-show --tail`) |

---

### Search API

| Command | Description |
|---------|-------------|
| `lando sapi` | Reindex all Search API indexes (`sapi-r` then `sapi-i`) |

---

### PHP quality tools

These commands pass all extra arguments through to the underlying tool.

| Command | Example | Description |
|---------|---------|-------------|
| `lando phpcs` | `lando phpcs web/modules/custom` | PHP CodeSniffer (full + summary + source reports) |
| `lando phpstan` | `lando phpstan web/modules/custom` | PHPStan static analysis |
| `lando phpunit` | `lando phpunit` | PHPUnit (`--testdox`) |

---

## Typical workflow

```bash
# Pull the latest production database locally and deploy
lando db-prod-import

# Work, then check logs
lando watchdog

# Re-deploy after a config change
lando db-deploy

# Dump and push the local DB to preprod
lando db-dump
lando db-preprod-send
```

---

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).

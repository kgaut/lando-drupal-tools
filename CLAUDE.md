# lando-drupal-tools — notes for Claude

## Architecture du plugin Lando v3

### Deux fichiers, deux rôles distincts

| Fichier | Signature | Rôle |
|---------|-----------|------|
| `index.js` | `module.exports = lando => {}` | Hook global — reçoit l'objet `lando` |
| `app.js` | `module.exports = (app, lando) => {}` | Hook app-level — appelé pour chaque app **après** que la task list est déjà construite |

`app.js` est chargé automatiquement par Lando quand le plugin est référencé (via `plugins:` dans `.lando.yml` ou `.lando.local.yml`).

### Pourquoi le tooling doit être injecté dans `index.js` via `post-bootstrap-app`

Le cycle d'initialisation Lando v3 est :
```
pre-bootstrap-config → post-bootstrap-config
→ pre-bootstrap-tasks → post-bootstrap-tasks   ← task list construite ici
→ pre-bootstrap-engine → post-bootstrap-engine
→ pre-bootstrap-app → post-bootstrap-app        ← notre hook index.js
→ post-bootstrap → almost-ready → ready
→ app.js est appelé                              ← trop tard pour la task list
```

**`app.js` tourne après `ready`**, donc toute modification de `app.config.tooling` dans `app.js` est ignorée pour l'affichage des commandes. Il faut accrocher sur `post-bootstrap-app` dans `index.js` et modifier `lando.appConfig.tooling`.

```js
// index.js — la seule façon de faire apparaître les commandes dans `lando`
module.exports = lando => {
  lando.events.on('post-bootstrap-app', lando2 => {
    const ac = lando2.appConfig;
    if (!ac) return;
    // ac.drupal_tools contient déjà la config mergée .lando.yml + .lando.local.yml
    ac.tooling = Object.assign({}, myTooling, ac.tooling || {});
  });
};
```

### Installation globale — Lando v3.21+

Lando v3.21+ **ne charge plus automatiquement** les plugins non-scopés depuis `~/.lando/plugins/`. Seuls les `@lando/*` sont auto-découverts.

**La seule méthode fiable** : référencer le plugin explicitement dans `.lando.local.yml` :
```yaml
plugins:
  lando-drupal-tools: ~/.lando/plugins/lando-drupal-tools
```

Un simple `git clone` dans `~/.lando/plugins/lando-drupal-tools` ne suffit pas.

---

## Règles sur les `cmd` dans le tooling Lando

### Règle principale : zéro guillemet simple dans les `cmd`

Lando v3 enveloppe les `cmd` dans son propre contexte shell avec des guillemets simples :
```
bash -c 'notre cmd string'
```

Tout guillemet simple (`'`) à l'intérieur casse immédiatement ce wrapping et provoque une **sortie silencieuse sans aucun output**.

### Ce qui marche vs ce qui ne marche pas

```js
// ✅ OK — commande simple sans guillemets simples
cmd: 'drush sql-drop --yes'

// ✅ OK — double guillemets autorisés (littéraux à l'intérieur des simples)
cmd: 'echo "hello world"'

// ✅ OK — variables shell et $() sans guillemets simples
cmd: 'DUMP=$(ls -t /app/db/*.sql.gz | head -1); echo $DUMP'

// ❌ CASSÉ — guillemets simples imbriqués
cmd: "bash -c 'drush sql-dump'"

// ❌ CASSÉ — ssh avec remote cmd entre guillemets simples
cmd: "ssh user@host 'cd /path && drush sql-dump'"
```

### Commandes locales multi-étapes

Pas besoin de `bash -c '...'` — Lando s'en charge. Écrire le script directement :
```js
// ❌ Avant (cassé)
cmd: `bash -c 'mkdir -p /app/db && drush sql-dump --gzip --result-file=/app/db/dump.sql'`

// ✅ Après
cmd: `mkdir -p /app/db && drush sql-dump --gzip --result-file=/app/db/dump.sql`
```

### Commandes SSH avec script distant

Remplacer `ssh user@host 'remote cmd'` par `printf | ssh bash -s` :
```js
// ❌ Avant (guillemets simples cassent le wrapping Lando)
cmd: `ssh user@host 'cd ~/path && drush sql-dump --gzip > dump.sql.gz'`

// ✅ Après (aucun guillemet simple, script passé via stdin)
const remoteScript = `cd ~/path && drush sql-dump --gzip > dump.sql.gz && echo Done`;
cmd: `printf %s "${remoteScript}" | ssh user@host bash -s`
```

**Attention** : le `printf %s "..."` évalue `$(date)` localement (dans le container). C'est acceptable — le timestamp container suffit pour nommer les dumps.

### Récupérer la liste des fichiers distants

```js
// ❌ Avant (guillemets simples)
`DUMP=$(ssh user@host 'ls -t ~/path/ | grep sql.gz | head -1');`

// ✅ Après
`DUMP=$(printf %s "ls -t ~/path/ | grep sql.gz | head -1" | ssh user@host bash -s);`
```

### SSH interactif

```js
// ❌ Avant (guillemets simples)
cmd: `ssh -p 22 user@host -t 'cd ~/path && exec $SHELL -l'`

// ✅ Après (doubles guillemets — littéraux à l'intérieur du wrapping single-quote de Lando)
cmd: `ssh -p 22 user@host -t "cd ~/path; exec bash -l"`
```

---

## Cache Lando — deux niveaux à connaître

| Cache | Commande pour vider | Contenu |
|-------|---------------------|---------|
| Task list cache | `lando --clear` | Liste des commandes affichées dans `lando` |
| Tooling router | `lando rebuild -y` | Comment **exécuter** chaque commande |

Après un changement de `tooling.js` :
- `lando --clear` suffit pour voir les nouvelles commandes dans `lando`
- `lando rebuild -y` est nécessaire pour que les nouvelles commandes s'exécutent correctement

---

## Tests utiles pour déboguer

```bash
# Vérifier qu'une commande s'exécute dans le container
lando exec appserver -- /bin/sh -c 'echo test'

# Vérifier la connectivité SSH
lando exec appserver -- /bin/sh -c 'ssh user@host echo test'

# Tester printf | ssh manuellement
lando exec appserver -- /bin/sh -c 'printf %s "echo remote_ok" | ssh user@host bash -s'

# Voir tous les plugins chargés par Lando
lando config 2>&1 | grep -A3 "name.*drupal-tools"

# Voir les events Lando dans les logs
cat ~/.lando/logs/lando.log | grep "emitting event"
```

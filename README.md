# JSEO 2026

Site de la **Journée scientifique des écosystèmes d'optimisation**
Faculté de Mathématiques, USTHB, Alger. 22 octobre 2026.

Réalisé par [Tarmacq Agency](https://www.tarmacq.com).

Site statique sans étape de build, plus une fonction serveur qui authentifie
l'auteur, enregistre la soumission dans Supabase et envoie les deux courriels
de confirmation.

---

## Contenu

```
index.html          Accueil               en/index.html   Home
appel.html          Appel à communication en/call.html     Call for papers
infos.html          Informations          en/info.html     Practical information
soumission.html     Soumission            en/submit.html   Submission

assets/css/style.css    Feuille de style unique
assets/js/main.js       Navigation mobile, états des cartes de choix
assets/js/auth.js       Session Tarmacq OAuth et config Supabase
assets/js/form.js       Validation, dépôt de fichier, appel à l'API
assets/img/             Logo et favicon

api/submit.js       Réception de la soumission, captcha, envoi des courriels
api/_supabase.js    Vérification du jeton et écriture en base
supabase/schema.sql Table, index, RLS et bucket a créer une fois
server.js           Serveur local (statique + API) pour tester
```

Le site s'ouvre tel quel dans un navigateur, mais **le formulaire n'envoie
rien tant qu'il n'est pas servi par `server.js` ou déployé**, car il a besoin
de la route `/api/submit`.

---

## Le site bilingue

Le français vit à la racine, l'anglais dans `en/`. Chaque page porte un
sélecteur FR / EN dans l'en-tête, qui pointe vers son équivalent exact, et une
balise `hreflang` qui déclare la paire aux moteurs de recherche.

| Français | Anglais |
| --- | --- |
| `index.html` | `en/index.html` |
| `appel.html` | `en/call.html` |
| `infos.html` | `en/info.html` |
| `soumission.html` | `en/submit.html` |

Le contenu est écrit en clair dans chaque fichier, sans gabarit ni clés de
traduction : **une correction de texte doit être reportée dans les deux
versions.** C'est le prix d'un site que le comité peut modifier directement.

En revanche, tout ce qui est dynamique est mutualisé :

- `assets/js/form.js` porte un dictionnaire `STRINGS` (`fr` et `en`) et
  choisit la langue d'après l'attribut `lang` de la page. Un même script sert
  les deux formulaires.
- `api/submit.js` porte le même principe avec `MSG` et `AUTHOR_MAIL`. La
  langue arrive par le champ caché `locale` du formulaire, doublée du
  paramètre `?lang=` pour les erreurs levées avant la lecture du corps.
- **L'accusé de réception part dans la langue du formulaire utilisé.** Le
  courriel destiné au comité reste en français et indique, sur une ligne
  dédiée, la langue dans laquelle le formulaire a été rempli.

Une valeur inconnue retombe systématiquement sur le français.

### Note sur les URL

`cleanUrls` est passé à `false` dans `vercel.json`. Avec `cleanUrls`, la page
`/en/index.html` est servie sous `/en`, sans barre oblique finale : un lien
relatif `call.html` s'y résout alors en `/call.html`, donc sur la version
française. Les URL portent désormais leur extension, et des redirections
conservent les anciennes adresses sans extension.

---

## Chaîne de soumission

```
navigateur                                   serveur
----------                                   -------
config.js  (api.tarmacq.com)  ---------->  domaine autorisé requis
login      (auth.tarmacq.com) ---------->  redirection, retour avec access_token
Turnstile                     ---------->  jeton de défi

POST /api/submit  +  Authorization: Bearer <access_token>
                                             |
                                             +-- Supabase /auth/v1/user   verifie le jeton
                                             +-- Cloudflare siteverify    verifie le captcha
                                             +-- Storage + insert         enregistre
                                             +-- SMTP x2                  courriels
```

Trois points importants :

- **L'adresse e-mail retenue est celle du compte vérifié**, pas celle du
  formulaire. Le champ est en lecture seule et le serveur l'écrase de toute
  façon.
- **Le jeton est revérifié côté serveur** à chaque soumission. Le blocage
  affiché dans la page n'est qu'un confort, il ne protège rien à lui seul.
- **La clé de site Turnstile ne protège rien non plus.** Seul l'appel
  `siteverify` fait avec la clé secrète compte.

---

## 1. Configurer l'envoi des courriels

Le service utilise le compte Gmail du comité pour émettre les deux messages.
Gmail refuse le mot de passe habituel : il faut un **mot de passe
d'application**.

1. Connectez-vous au compte `jseo.metaheuristiques2026@gmail.com`.
2. Activez la validation en deux étapes :
   https://myaccount.google.com/signinoptions/two-step-verification
3. Créez un mot de passe d'application :
   https://myaccount.google.com/apppasswords
   Nommez-le par exemple « Site JSEO ». Google affiche 16 caractères.
4. Copiez `.env.example` vers `.env` et collez ces 16 caractères dans
   `JSEO_MAIL_PASS` (sans espaces).

```bash
cp .env.example .env
```

Le mot de passe d'application ne doit jamais être publié. Le fichier `.env`
est déjà exclu par `.gitignore`.

---

## 1 bis. Supabase, Turnstile et l'authentification

### Supabase

1. Dans le SQL editor du projet, exécutez `supabase/schema.sql`. Il crée la
   table `jseo_submissions`, ses index, la RLS et le bucket privé
   `jseo-resumes`.
2. Relevez dans **Settings, API** : l'URL du projet, la clé publique et la clé
   `service_role`. Reportez-les dans `.env`.

Le projet utilise les clés de nouvelle génération : la clé publique servie par
`api.tarmacq.com` est de la forme `sb_publishable_...` et non un JWT `eyJ...`.
Cela ne change rien au code, elle est transmise telle quelle dans l'en-tête
`apikey`.

Tant que `schema.sql` n'a pas été exécuté, `/rest/v1/jseo_submissions` répond
404 et toute soumission repart avec `stored: false` : les courriels partent
quand même, avec un avertissement visible dans celui du comité.

Deux règles à ne pas contourner :

- La clé **`service_role` reste côté serveur**. Elle ignore la RLS et donne un
  accès complet à la base. Elle ne doit jamais apparaître dans
  `api.tarmacq.com/api/config.js`, qui est lu par le navigateur.
- La **RLS reste activée** sur `jseo_submissions`. Sans elle, la clé `anon`,
  qui est publique, permettrait de lire toutes les soumissions.

### Cloudflare Turnstile

La clé de site `0x4AAAAAAEUe1CkVydD2ZPcc` est déjà dans `soumission.html`.
Dans le tableau de bord Cloudflare, ajoutez `jseo.tarmacq.com` (et
`localhost` pour les tests) aux domaines autorisés du widget, puis copiez la
clé secrète dans `TURNSTILE_SECRET_KEY`.

### Config et connexion Tarmacq

`assets/js/auth.js` regroupe les deux points d'entrée :

```js
var CONFIG_URL = 'https://api.tarmacq.com/api/config';   // sans .js
var AUTH_URL   = window.JSEO_AUTH_URL || 'https://auth.tarmacq.com/distribution/services/jseo';
```

**L'URL de config ne porte pas l'extension `.js`.** Vercel répond à
`/api/config.js` par une redirection 308 vers `/api/config`, et une réponse de
redirection ne porte pas d'en-tête `Access-Control-Allow-Origin` : le
navigateur rejette donc la requête sur la politique CORS avant même
d'atteindre le handler. Vérifié :

```
GET /api/config.js   Origin: https://jseo.tarmacq.com   ->  308, pas d'ACAO
GET /api/config      Origin: https://jseo.tarmacq.com   ->  200, ACAO correct
GET /api/config      sans Origin                        ->  403
```

La config est lue par `fetch` et `JSON.parse`, jamais par une balise
`<script>` : une balise script classique n'envoie pas d'en-tête `Origin` et
tombe systématiquement sur la branche 403 de votre handler. Les clés lues sont
`supabaseUrl` et `supabaseKey`, telles que servies. Pour court-circuiter
l'appel réseau, définissez avant le script :

```html
<script>window.JSEO_SUPABASE = { supabaseUrl: '...', supabaseKey: '...' };</script>
```

### L'URL de connexion

`login()` envoie l'utilisateur sur :

```
https://auth.tarmacq.com/distribution/services/jseo?service=jseo&redirect_uri=<retour>&redirect=<retour>
```

Le chemin peut être remplacé sans toucher au code, en le déclarant avant le
script :

```html
<script>window.JSEO_AUTH_URL = 'https://auth.tarmacq.com/un-autre-chemin';</script>
```

Le retour est attendu sous la forme `...soumission.html#access_token=...` ou `...en/submit.html#access_token=...` (le
paramètre est aussi accepté en query, et sous le nom `token`). Le jeton est
retiré de l'URL dès sa lecture et conservé en `sessionStorage`. Si vos noms de
paramètres diffèrent, ajustez `login()` et `readParams()`.

---

## 2. Lancer en local

Node.js 18 ou plus récent est nécessaire (https://nodejs.org).

```bash
npm install
```

Puis, sous PowerShell :

```powershell
Get-Content .env | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object { $n, $v = $_ -split '=', 2; Set-Item "env:$($n.Trim())" $v.Trim() }; node server.js
```

Le site répond sur http://localhost:3000. Soumettez un formulaire de test pour
vérifier que les deux courriels arrivent bien.

---

## 3. Mettre en ligne

Vercel est le chemin le plus court, la fonction `api/submit.js` y fonctionne
sans configuration supplémentaire.

```bash
npm install -g vercel
vercel
```

Dans le tableau de bord Vercel, onglet **Settings, Environment Variables**,
ajoutez pour l'environnement Production :

| Variable | Valeur |
| --- | --- |
| `JSEO_MAIL_USER` | `jseo.metaheuristiques2026@gmail.com` |
| `JSEO_MAIL_PASS` | le mot de passe d'application |
| `JSEO_STAFF_EMAIL` | `jseo.metaheuristiques2026@gmail.com` |
| `TURNSTILE_SECRET_KEY` | la clé secrète du widget Turnstile |
| `SUPABASE_URL` | l URL du projet Supabase |
| `SUPABASE_ANON_KEY` | la clé anon |
| `SUPABASE_SERVICE_ROLE_KEY` | la clé service_role |

Toutes ces variables doivent être présentes. Si l'une manque, la page de
soumission affiche désormais la liste exacte des variables absentes plutôt
qu'une erreur générique.

Puis redéployez :

```bash
vercel --prod
```

Pensez à déclarer le domaine de production (`jseo.tarmacq.com`) dans les
origines autorisées de `api.tarmacq.com`, dans les URL de redirection
acceptées par `auth.tarmacq.com`, et dans les domaines du widget Turnstile.
Ces trois listes sont la cause la plus fréquente d'une page de soumission
bloquée sur « Connexion indisponible ».

Un hébergement purement statique (GitHub Pages, hébergeur universitaire sans
Node) ne convient plus : la vérification du jeton, celle du captcha et
l'écriture en base demandent toutes un serveur.

---

## 4. Ce que fait le formulaire

La page n'affiche le formulaire qu'une fois l'auteur connecté. À la validation :

0. **Le serveur vérifie le jeton puis le captcha.** Un jeton absent ou expiré
   renvoie un 401, la page repasse alors sur l'écran de connexion sans perdre
   la saisie. Un captcha refusé renvoie un 400.
1. **La soumission est enregistrée** dans la table `jseo_submissions` et le
   fichier déposé dans le bucket `jseo-resumes`, sous `RÉFÉRENCE/NOM.pdf`.
   Si cette étape échoue, la soumission n'est pas perdue pour autant : les
   courriels partent quand même et celui du comité porte un avertissement
   bien visible.
2. **Le dossier part vers le comité**, à l'adresse `JSEO_STAFF_EMAIL`, avec
   toutes les réponses mises en page et le fichier en pièce jointe, renommé
   `JSEO26-XXXXXX_NOM.pdf`. Le champ `Répondre à` pointe sur l'auteur, il
   suffit de répondre au message pour lui écrire.
3. **L'auteur reçoit un accusé de réception** confirmant que la soumission est
   bien parvenue au comité, avec sa référence, le rappel de sa communication
   et la date de notification.
4. La page affiche la référence de soumission.

Si le premier envoi échoue, la page le signale et propose l'adresse du comité.
Si seul l'accusé de réception échoue, la soumission reste enregistrée côté
comité, le champ `acknowledged` de la réponse passe à `false`.

Garde-fous en place : connexion obligatoire avec jeton revérifié côté serveur,
captcha Turnstile validé côté serveur, adresse e-mail imposée par le compte,
validation dans le navigateur et sur le serveur, limite de 10 Mo, extensions
`.pdf`, `.doc` et `.docx` seulement, champ piège contre les robots.

---

## 5. À compléter avant la mise en ligne

Les emplacements sont signalés dans les pages par une étiquette orange
« À compléter ».

- `infos.html` et `en/info.html` : salle exacte et format présentiel ou hybride.

Les comités scientifique et d'organisation ne figurent plus sur le site, à la
demande du comité. Le balisage `.people` reste disponible dans la feuille de
style si ces sections doivent revenir.

Un point relevé dans les documents source : les consignes du modèle de résumé
annoncent une **date limite d'envoi au 30 septembre 2026**, alors que la
section « Dates importantes » du même document indique le **12 octobre 2026**.
Le site retient le 12 octobre. À corriger dans le modèle si besoin.

---

## 6. Remplacer le logo

`assets/img/logo-jseo.svg` est une reconstruction vectorielle de l'emblème.
Pour utiliser votre fichier original, déposez-le sous
`assets/img/logo-jseo.png`, puis remplacez l'extension dans les quatre pages :

```bash
sed -i 's|logo-jseo.svg|logo-jseo.png|g' index.html appel.html infos.html soumission.html
```

---

## 7. Modifier le contenu

Tout le texte est directement dans les fichiers `.html`, il n'y a ni gabarit
ni générateur. Les couleurs, espacements et polices sont regroupés en haut de
`assets/css/style.css` dans le bloc `:root`.

L'en-tête et le pied de page sont recopiés dans chaque page : une
modification doit être répercutée dans les quatre fichiers.

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
index.html          Accueil
appel.html          Appel à communication et les quatre axes
infos.html          Dates, comités, informations pratiques
soumission.html     Formulaire de soumission

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
2. Relevez dans **Settings, API** : l'URL du projet, la clé `anon` et la clé
   `service_role`. Reportez-les dans `.env`.

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
var CONFIG_URL = 'https://api.tarmacq.com/api/config.js';
var AUTH_URL   = 'https://auth.tarmacq.com/dist/services/jseo';
```

Le chargement de la config essaie, dans l'ordre : une balise `<script>` puis
lecture d'un global (`TARMACQ_CONFIG`, `SUPABASE_CONFIG`, `APP_CONFIG`,
`CONFIG`...), sinon `fetch` et `JSON.parse`, sinon extraction de l'URL et de
la clé dans le texte. **Si le nom réel du global ou la forme de la réponse
diffère, ajoutez-le à `GLOBALS` / `URL_KEYS` / `KEY_KEYS` en haut du
fichier.** Pour court-circuiter entièrement la découverte, définissez avant
le script :

```html
<script>window.JSEO_SUPABASE = { supabaseUrl: '...', supabaseAnonKey: '...' };</script>
```

Pour la connexion, l'utilisateur est envoyé sur `AUTH_URL` avec
`redirect_uri`, `redirect` et `service=jseo`, et le retour est attendu sous la
forme `...soumission.html#access_token=...` (le paramètre est aussi accepté en
query, et sous le nom `token`). Le jeton est retiré de l'URL dès sa lecture et
conservé en `sessionStorage`. **Si votre service utilise d'autres noms de
paramètres, ajustez `login()` et `readParams()`.**

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

- `infos.html` : membres du comité scientifique et du comité d'organisation,
  salle exacte, format présentiel ou hybride, adresse du site une fois en
  ligne.
- `appel.html` : lien vers le modèle de résumé. Déposez le document dans
  `assets/docs/` puis remplacez l'étiquette par un lien.

Deux points relevés dans les documents source, à trancher de votre côté :

- La **date limite de soumission et la notification aux auteurs portent toutes
  deux le 10 octobre 2026**. Les pages reprennent cette date telle quelle.
- La phrase « **Adaptée** isolément, une métaheuristique... » est reprise mot
  pour mot de l'appel. « Appliquée » était peut-être l'intention.

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

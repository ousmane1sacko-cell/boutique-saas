# Boutique — version en ligne (SaaS)

Application de gestion pour petits commerces : ventes, stock, clients et ardoises.
Comptes avec e-mail et mot de passe, données stockées sur le serveur, accessible
depuis n'importe quel téléphone.

## Contenu

- `server.js` — serveur HTTP Node.js, sans aucune dépendance externe
- `public/index.html` — l'application (interface mobile)
- `package.json` — scripts de démarrage
- `data/db.json` — base de données créée automatiquement au premier lancement

## Lancer en local

    node server.js

Puis ouvrir http://localhost:3000

Variables d'environnement :

- `PORT` — port d'écoute (3000 par défaut)
- `DATA_DIR` — dossier de stockage des données

## Mettre en ligne

### Option 1 — Render (gratuit pour tester)

1. Créer un dépôt GitHub et y pousser ce dossier.
2. Sur render.com : New > Web Service, choisir le dépôt.
3. Build command : `npm install` · Start command : `node server.js`.
4. Ajouter un disque persistant (Disk) monté sur `/var/data` et définir
   `DATA_DIR=/var/data`, sinon les données sont perdues à chaque redéploiement.
5. Ouvrir l'URL fournie : l'application est en ligne.

### Option 2 — Serveur VPS (recommandé en production)

    sudo apt install nodejs npm
    cd /opt && unzip boutique-saas.zip -d boutique
    cd boutique && npm install --omit=dev
    DATA_DIR=/var/lib/boutique PORT=3000 node server.js

Garder le processus en vie avec pm2 :

    sudo npm i -g pm2
    DATA_DIR=/var/lib/boutique pm2 start server.js --name boutique
    pm2 save && pm2 startup

Puis placer Nginx devant avec un certificat HTTPS (Let's Encrypt).

## Sécurité et limites

- Mots de passe hachés avec scrypt et sel unique ; sessions en cookie HttpOnly 30 jours.
- Servir le site en HTTPS en production.
- Une boutique par compte. Sauvegarder régulièrement `db.json`.
- Prochaines étapes possibles : plusieurs vendeurs par boutique avec rôles,
  journal des actions, export comptable, abonnement payant.

## Sauvegarde

    cp data/db.json data/db-$(date +%F).json

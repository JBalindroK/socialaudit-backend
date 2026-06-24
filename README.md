# SocialAudit.be Backend API

Backend Node.js/Express pour la vérification préventive des fiches de paie intérimaires.

## Installation

```bash
npm install
```

## Variables d'environnement

Créer un fichier `.env` à la racine :

| Variable           | Description                              | Exemple                     |
|--------------------|------------------------------------------|-----------------------------|
| `ANTHROPIC_API_KEY` | Clé API Anthropic (Claude)              | `sk-ant-...`                |
| `API_TOKEN`        | Token d'authentification pour les clients | `393d29ba...` (généré)     |
| `PORT`             | Port d'écoute du serveur                | `3001`                      |

## Démarrage

```bash
# Production
npm start

# Développement (rechargement automatique)
npm run dev
```

## Routes

| Méthode | Route      | Auth requise | Description                         |
|---------|------------|--------------|-------------------------------------|
| GET     | `/`        | Non          | Health check                        |
| GET     | `/status`  | Non          | Statut public de l'API              |
| POST    | `/analyze` | Oui          | Analyse d'une fiche de paie PDF     |

## Authentification

Toutes les routes sauf `GET /` et `GET /status` requièrent le header :

```
x-api-token: <API_TOKEN>
```

Réponse en cas d'absence ou de token invalide : `401 { "error": "Non autorisé" }`

## POST /analyze

**Corps de la requête (JSON) :**
```json
{
  "fileBase64": "<PDF encodé en base64>"
}
```

**Réponse (JSON) :**
```json
{
  "salaire_brut": 2500.00,
  "salaire_net": 1850.00,
  "heures_travaillees": 160,
  "taux_horaire": 15.625,
  "precompte_professionnel": 450.00,
  "cotisations_sociales": 200.00,
  "prime_fin_contrat": 125.00,
  "pecule_vacances": 208.33,
  "periode": "Juin 2025",
  "employeur": "Acme Interim SA",
  "travailleur": "Jean Dupont",
  "anomalies": [],
  "score_conformite": 95,
  "resume": "Fiche de paie conforme à la législation belge."
}
```

## Limites

- Rate limiting : 10 requêtes par minute par IP
- Taille maximale du PDF : 10 MB (13 MB en base64)

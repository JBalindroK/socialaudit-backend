// ─── IMPORTS ────────────────────────────────────────────────────────────────
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');

// ─── CONFIG ─────────────────────────────────────────────────────────────────
dotenv.config();

const PORT = process.env.PORT || 3001;
const API_TOKEN = process.env.API_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const app = express();

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────

// CORS
app.use(cors());

// JSON body parser
app.use(express.json({ limit: '20mb' }));

// Rate limiting — max 10 requêtes/min par IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans 1 minute' },
});
app.use(limiter);

// Auth middleware — toutes les routes sauf GET / et GET /status
function authMiddleware(req, res, next) {
  const bypass =
    (req.method === 'GET' && req.path === '/') ||
    (req.method === 'GET' && req.path === '/status');

  if (bypass) return next();

  const token = req.headers['x-api-token'];
  if (!token || token !== API_TOKEN) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
}
app.use(authMiddleware);

// ─── ROUTES ─────────────────────────────────────────────────────────────────

// GET / → health check
app.get('/', (req, res) => {
  res.json({ ok: true });
});

// GET /status → statut API public (sans auth)
app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    version: '1.0.0',
    service: 'SocialAudit.be API',
  });
});

// POST /analyze → analyse fiche PDF
app.post('/analyze', async (req, res) => {
  // Validation input
  const { fileBase64 } = req.body;

  if (!fileBase64) {
    return res.status(400).json({ error: 'Fichier manquant ou trop volumineux' });
  }

  // ~13 MB en base64 ≈ 10 MB fichier réel (chaque 3 octets → 4 chars base64)
  const MAX_BASE64_LENGTH = 13 * 1024 * 1024;
  if (fileBase64.length > MAX_BASE64_LENGTH) {
    return res.status(400).json({ error: 'Fichier manquant ou trop volumineux' });
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: fileBase64,
              },
            },
            {
              type: 'text',
              text: `Tu es un expert en droit social belge spécialisé dans les fiches de paie intérimaires.
Analyse cette fiche de paie et retourne UNIQUEMENT un objet JSON valide avec la structure suivante :
{
  "salaire_brut": number | null,
  "salaire_net": number | null,
  "heures_travaillees": number | null,
  "taux_horaire": number | null,
  "precompte_professionnel": number | null,
  "cotisations_sociales": number | null,
  "prime_fin_contrat": number | null,
  "pecule_vacances": number | null,
  "periode": string | null,
  "employeur": string | null,
  "travailleur": string | null,
  "anomalies": string[],
  "score_conformite": number,
  "resume": string
}
Le score_conformite va de 0 (non conforme) à 100 (parfaitement conforme).
anomalies est un tableau de strings décrivant les problèmes détectés (vide si aucun).
Ne renvoie rien d'autre que le JSON.`,
            },
          ],
        },
      ],
    });

    const rawText = response.content[0]?.text || '';

    // Extraire le JSON (Claude peut ajouter du texte autour)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(422).json({ error: 'Résultat invalide' });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(422).json({ error: 'Résultat invalide' });
    }

    return res.json(parsed);
  } catch (err) {
    console.error('[/analyze] Erreur:', err?.message || err);

    // Timeout ou erreur réseau
    if (
      err?.code === 'ECONNRESET' ||
      err?.code === 'ETIMEDOUT' ||
      err?.status === 529 ||
      err?.message?.includes('timeout')
    ) {
      return res.status(503).json({ error: 'Service temporairement indisponible' });
    }

    // Erreur Claude générique
    return res.status(503).json({ error: 'Service temporairement indisponible' });
  }
});

// ─── START SERVER ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ SocialAudit.be API démarrée sur http://localhost:${PORT}`);
  console.log(`   GET  /status  → statut public`);
  console.log(`   POST /analyze → analyse fiche PDF (x-api-token requis)`);
});

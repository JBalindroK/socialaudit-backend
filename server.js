// --- IMPORTS ---
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');

// --- CONFIG ---
dotenv.config();

const PORT = process.env.PORT || 3001;
const API_TOKEN = process.env.API_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const app = express();

// --- MIDDLEWARE ---

app.use(cors());
app.use(express.json({ limit: '20mb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans 1 minute' },
});
app.use(limiter);

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

// --- ROUTES ---

app.get('/', (req, res) => {
  res.json({ ok: true });
});

app.get('/status', (req, res) => {
  res.json({ status: 'online', version: '1.0.0', service: 'SocialAudit.be API' });
});

app.post('/analyze', async (req, res) => {
  const { fileBase64, cp, country } = req.body;

  if (!fileBase64) {
    return res.status(400).json({ error: 'Fichier manquant ou trop volumineux' });
  }
  if (fileBase64.length > 13 * 1024 * 1024) {
    return res.status(400).json({ error: 'Fichier manquant ou trop volumineux' });
  }

  const pays = country || 'BE';
  const cpSecteur = cp || '322';

  const prompt =
    'Tu es un expert en droit social belge et français spécialisé dans les fiches de paie intérimaires.\n' +
    'Analyse cette fiche de paie et retourne UNIQUEMENT un objet JSON valide, sans aucun texte avant ou apres.\n\n' +
    'Pays: ' + pays + '\n' +
    'CP secteur client: ' + cpSecteur + '\n\n' +
    "RÈGLES D'ANALYSE :\n" +
    '- Vérifie que le taux horaire correspond au minimum de la CP du secteur client\n' +
    '- Vérifie les sursalaires dimanche/fériés (+100% obligatoire)\n' +
    '- Vérifie la prime de nuit (CCT n49 : 1.51EUR/h minimum depuis jan 2026)\n' +
    '- Vérifie les heures supplémentaires P10 (calculees sur le taux reel du poste)\n' +
    '- Vérifie que la qualification professionnelle est mentionnée explicitement\n' +
    '- Pour la France : vérifie IFM 10% et ICP 10% obligatoires\n' +
    '- ONSS : 13.07% sur salaire brut x 108% (Belgique)\n\n' +
    'NIVEAUX DE CONFORMITÉ :\n' +
    '- NON CONFORME : au moins 1 point bloquant (violation loi ou CP)\n' +
    '- RISQUE MODÉRÉ : aucun point bloquant mais des points d\'attention\n' +
    '- PRÊTE À ÉMETTRE : aucun point bloquant ni critique\n\n' +
    'Structure JSON attendue (respecter EXACTEMENT ces noms de champs) :\n' +
    '{\n' +
    '  "worker": {\n' +
    '    "name": "Prénom Nom du travailleur",\n' +
    '    "cp": "CP 322 - CP XXX (Secteur)",\n' +
    '    "regime": "Ouvrier/Employé intérimaire",\n' +
    '    "qualification": "qualification mentionnée sur la fiche ou null"\n' +
    '  },\n' +
    '  "conformite_globale": "NON CONFORME" ou "RISQUE MODÉRÉ" ou "PRÊTE À ÉMETTRE",\n' +
    '  "score": 0-100,\n' +
    '  "_month": "Mois de la fiche",\n' +
    '  "_year": 2026,\n' +
    '  "points_bloquants": [{ "code": "B01", "titre": "...", "detail": "...", "base_legale": "...", "niveau": "LOI|CP|CCT" }],\n' +
    '  "points_attention": [{ "code": "A01", "titre": "...", "detail": "...", "base_legale": "...", "niveau": "LOI|CP|CCT" }],\n' +
    '  "points_conformes": ["Description courte d\'un élément conforme"],\n' +
    '  "corrections_requises": ["Action concrète à effectuer avant émission"],\n' +
    '  "note_contexte": "Note générale sur la fiche et son contexte"\n' +
    '}\n\n' +
    'IMPORTANT :\n' +
    '- points_bloquants = violations légales ou conventionnelles obligatoires à corriger AVANT émission\n' +
    '- points_attention = éléments à vérifier mais non bloquants\n' +
    '- points_conformes = liste des éléments vérifiés et conformes\n' +
    '- corrections_requises = liste des actions concrètes à faire (vide si PRÊTE À ÉMETTRE)\n' +
    '- score : 0-40 si NON CONFORME, 41-70 si RISQUE MODÉRÉ, 71-100 si PRÊTE À ÉMETTRE\n' +
    '- Ne jamais inventer des données absentes de la fiche\n' +
    "- Si une information est manquante, le signaler en point d'attention";

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const rawText = response.content[0]?.text || '';
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
    if (
      err?.code === 'ECONNRESET' ||
      err?.code === 'ETIMEDOUT' ||
      err?.status === 529 ||
      err?.message?.includes('timeout')
    ) {
      return res.status(503).json({ error: 'Service temporairement indisponible' });
    }
    return res.status(503).json({ error: 'Service temporairement indisponible' });
  }
});

// --- START SERVER ---
app.listen(PORT, () => {
  console.log('SocialAudit.be API démarrée sur http://localhost:' + PORT);
  console.log('   GET  /status  -> statut public');
  console.log('   POST /analyze -> analyse fiche PDF (x-api-token requis)');
});

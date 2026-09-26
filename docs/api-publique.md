# API publique limitée (site web, WordPress)

Étape 12 (prompt 12, section 7.2 groupe Public). Pour les pages publiques de Neomoov et le site WordPress : devis sans compte, recherche d'adresses et prospects (préinscription des chauffeurs, demandes d'entreprises et de partenaires). Le suivi partagé d'une course est public par son lien signé.

## Accès

- Clé d'API à la seule portée `public:write`, créée par un administrateur (`POST /v1/admin/api-keys`, voir `docs/runbooks/personnel-my-hub.md`). En-tête : `Authorization: Bearer nmk_…`.
- La clé reste sur un serveur : le serveur web Neomoov (`NEOMOOV_PUBLIC_API_KEY`, relais `/api/v1/public/*`) ou le serveur WordPress. Même visible, elle ne donne accès à rien d'autre que ces routes.
- Limites : 300 requêtes par minute et par adresse IP (générale), puis par heure et par adresse IP : 10 prospects (`public.leads_per_ip_per_hour`), 120 devis (`public.quotes_per_ip_per_hour`), 600 recherches d'adresses (`public.places_per_ip_per_hour`). Au-delà : 429 `RATE_LIMITED` avec `retryAfter`.
- Prospects : jeton Cloudflare Turnstile (`antiBotToken`) et consentement (`consent: true`) exigés.

## Routes

| Méthode et chemin | Rôle |
|---|---|
| `POST /v1/public/quotes` | Devis de toutes les catégories (ou d'une seule), mêmes règles que les applications, préavis de 2 heures. Affichage seulement : la réservation recalcule le prix avec le compte du client |
| `GET /v1/public/places/autocomplete?input=…&sessionToken=…` | Suggestions d'adresses |
| `GET /v1/public/places/details?placeId=…&sessionToken=…` | Adresse et coordonnées d'une suggestion |
| `POST /v1/public/leads` | Prospect : `kind` (`driver`, `business`, `partner`), prénom, téléphone E.164, courriel, ville, message, langue, `antiBotToken`, `consent` |
| `GET /v1/public/track/{jeton}` | Suivi partagé (sans clé) : état, destination, chauffeur et véhicule, position pendant la course. 404 lien inconnu, 410 lien expiré |

## Exemple d'appel

Appel réel enregistré par `apps/web/e2e/run.cjs` contre l'API locale (fournisseurs simulés, clé de test révoquée à la fin) :

```bash
curl -X POST https://api.neomoov.net/v1/public/quotes \
  -H "Authorization: Bearer nmk_…" \
  -H "Content-Type: application/json" \
  -H "Accept-Language: fr-CA" \
  -d '{"origin":{"address":"Aéroport international Montréal-Trudeau, Dorval, QC","coordinates":{"lat":45.4706,"lng":-73.7408}},"destination":{"address":"204, rue du Saint-Sacrement, Montréal, QC H2Y 1W8","coordinates":{"lat":45.5033,"lng":-73.5586}},"requestedAt":"2026-09-26T04:21:15.933Z","category":"neo_premium"}'
```

Réponse `201 Created` (extrait) :

```json
{
  "origin": "Aéroport international Montréal-Trudeau, Dorval, QC",
  "destination": "204, rue du Saint-Sacrement, Montréal, QC H2Y 1W8",
  "requestedAt": "2026-09-26T04:21:15.933Z",
  "distanceMeters": 19060,
  "durationSeconds": 2138,
  "estimated": false,
  "quotes": [
    {
      "id": "b9313160-2a83-4c74-bf87-486a3b95690c",
      "category": "neo_premium",
      "lines": [
        {
          "code": "flat_rate",
          "label": "Forfait",
          "amountCents": 4494
        },
        {
          "code": "service_fee",
          "label": "Frais de service",
          "amountCents": 200
        },
        {
          "code": "regulatory_fee",
          "label": "Redevance",
          "amountCents": 90
        },
        {
          "code": "gst",
          "label": "TPS",
          "amountCents": 239
        },
        {
          "code": "qst",
          "label": "TVQ",
          "amountCents": 477
        }
      ],
      "totalCents": 5500,
      "maxConsentedCents": 7500,
      "eta": {
        "seconds": null,
        "status": "on_availability"
      },
      "validUntil": "2026-09-26T01:26:16.062Z",
      "…": "autres champs (taxes détaillées, frais, empreinte)"
    }
  ]
}
```

Sans clé : `401` :

```json
{
  "code": "UNAUTHENTICATED",
  "message": "Jeton d'accès requis",
  "correlationId": "masjVXgL4ezkbdD3"
}
```

# DESIGN.md — Usine à vidéos, chaîne « amour »

> Source de vérité design du projet. Deux surfaces cohabitent et ne suivent
> pas les mêmes règles : **l'interface** (un outil) et **les vidéos** (une
> marque). Toute évolution visuelle majeure se répercute ici.

---

## Les deux registres

| Surface | Registre | Fichiers |
|---|---|---|
| **Interface** (`ui/`) | Outil tech : Inter partout, surfaces neutres, chiffres en monospace, angles nets | `ui/style.css` |
| **Vidéos** (`src/`) | Marque : burgundy, crème, sous-titres pastille, chaleur | `src/theme.ts`, `src/components/` |

Le burgundy `#8B2D4A` est le fil entre les deux : accent dans l'interface,
signature dans les vidéos. Il ne tapisse jamais, il signe.

---

## Interface : registre outil

### Principes

1. **La hiérarchie se fait par la graisse et la taille, jamais par un
   changement de famille.** Inter est la seule police de texte. Aucun serif.
2. **Tout ce qui est chiffré passe en monospace** : compteurs, crédits,
   durées, quotas, métadonnées. C'est le signal « donnée » de l'interface.
3. **L'utilisateur sait toujours ce qu'il va payer avant de cliquer** : le
   récapitulatif au-dessus du bouton Produire affiche format, voix, musique,
   durée estimée et coût en crédits.
4. **Le parcours est numéroté** : 1 Scripts, 2 Écriture, 3 Production. Une
   première prise en main ne demande aucune documentation.

### Palette (thème clair)

| Rôle | Valeur | Usage |
|---|---|---|
| Page | `#F6F6F8` | fond général, gris neutre froid |
| Surface | `#FFFFFF` | panneaux, cartes |
| Inset | `#F1F1F4` | zones encastrées (formulaires, rails) |
| Hairline | `#E4E4E9` | toutes les bordures |
| Texte | `#17171A` | jamais noir pur |
| Muted | `#6D6D77` | libellés secondaires (AA sur blanc) |
| Accent | `#8B2D4A` | CTA, étape en cours, élément choisi |

Thème sombre : charbons neutres (`#0B0B0D` / `#131316` / `#26262C`), le
burgundy ne sert jamais de couleur de texte sur fond sombre (contraste
insuffisant), uniquement d'aplat.

### Typographie

| Usage | Style |
|---|---|
| Titres de panneaux et de cartes | Inter 600–700, letter-spacing −0.02em |
| Corps | Inter 400–500, 13–15px |
| Libellés de sections | Inter 600, 10–11px, majuscules, letter-spacing 2px |
| Données chiffrées | `ui-monospace` (pile système), 11–12px |

### Formes

- Rayons : cartes 14px, CTA 10px, champs 8px. Pastilles d'état 7px.
- Ombres : discrètes (`0 1px 2px` au repos, `0 8px 24px` au survol).
- Segments (bascules) : rail incrusté `--inset` + curseur net.

### Composants clés

- **Récapitulatif** (`.recap`) : pastilles monospace au-dessus du CTA, la
  dernière (coût) est bordée d'accent.
- **Bloc Publier** (`.publish`) : titre, description créditée, tags et
  prompt de miniature, chacun copiable en un clic.
- **Barre de progression** : une jauge unique, préparation ≈ premier tiers,
  rendu le reste, temps écoulé en monospace.
- **Pastilles d'état** : vert = branché, rouge = indispensable manquant,
  gris bordé = facultatif absent. Rouge est réservé à ce qui bloque.
- **Étoile de favori** (voix) : ambre plein quand active, les favorites
  remontent en tête de liste.

---

## Vidéos : registre marque

### Sous-titres (`src/components/Captions.tsx`)

- **Majuscules**, sans points ni virgules à l'écran (la ponctuation reste
  dans le texte envoyé à la voix : elle pilote les respirations). `?` et `!`
  sont conservés, ils portent du sens.
- Pages de 1 à 3 mots, calées mot à mot sur l'audio.
- Mot actif : pastille burgundy, texte crème `#FBF9F7`. Mots inactifs :
  crème avec ombre portée, opacité 0.92.
- Police : grasse (800), interlettrage −0.02em.

### Image

- Vidéo Pexels en priorité, photo en repli avec mouvement Ken Burns lent.
- **Le premier beat (l'accroche) cherche toujours une vidéo**, même en
  montage photo : le mouvement arrête le défilement.
- Marge de zoom sur les photos : jamais de bord révélé, jamais de
  pixellisation.

### Voix et intonation

- La voix off ne lit pas, elle **joue** : chaque beat porte une `emotion`
  parmi douze, traduite en balise `eleven_v3`. Sans annotation, l'usine
  déduit — une question interpelle, une révélation se fait grave, une
  accroche est toujours `vif` ou `curieux`.
- Jamais la même intonation plus de deux beats de suite.
- `intime` et `soupir` sont des effets rares.

---

## Miniatures

La miniature n'illustre pas la vidéo : elle **incarne la peur que le
spectateur porte déjà**. Doctrine du prompt généré
(`pipeline/lib/thumbnail.mjs`, repris dans le bloc Publier) :

- Photo réaliste, gros plan serré, regard caméra, tension retenue — jamais
  de grimace, jamais de sourire.
- Lumière cinématographique contrastée, fond sombre flou, un seul accent
  burgundy.
- Texte incrusté : le `thumbnail_text` du script, 2 à 5 mots en majuscules
  qui nomment la peur (« TU N'AS PAS UN TYPE »), crème, ultra-gras, lisible
  sur téléphone, jamais sur le visage.
- Interdits : cartoon, 3D, watermark, texte supplémentaire.

Un script peut imposer son propre prompt via `youtube.thumbnail_prompt`.

---

## Écriture (tous supports)

- **Jamais de tiret cadratin** (`—`, `–`) : marqueur d'écriture IA.
  Utiliser `:`, un point, ou reformuler.
- Tous les accents français, y compris sur les majuscules.
- Pas d'emoji dans l'interface ni dans les métadonnées YouTube.
- Ton lucide et direct : la vérité qui dérange plutôt que le conseil tiède.

---

## Pièges à éviter (avant commit)

- [ ] Un serif s'est-il réintroduit dans l'interface ?
- [ ] Un chiffre est-il affiché en police de texte au lieu du monospace ?
- [ ] Un rouge s'affiche-t-il pour une option facultative ?
- [ ] Un tiret cadratin traîne-t-il quelque part ?
- [ ] La ponctuation basse apparaît-elle dans les sous-titres rendus ?
- [ ] Le coût en crédits est-il visible avant l'action qui paie ?
- [ ] Le `thumbnail_text` nomme-t-il une peur, ou décrit-il un sujet ?

---

*Dernière mise à jour : 10 août 2026 — v2.0, réécrit pour ce projet
(l'ancien DESIGN.md décrivait Compaatible, une application différente).*

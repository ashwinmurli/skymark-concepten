/* Skymark posttool: merkkleuren, kleurensets en templates.

   Bron: Figma-bestand "Skymark Social Templates" (mZA5qjhR1fsL5rZFvnw0ne),
   pagina's Templates en Final. Alle maten zijn pixels op het exportformaat
   (feed 1080x1350, story 1080x1920). Zodra een design in Figma definitief is,
   wordt het hier overgenomen; de veldnamen (fields/media) blijven gelijk,
   zodat bestaande concepten blijven werken.

   Laagtypes
   fill      volvlak in een kleurrol
   media     foto of video, "cover" in het kader, verschuif- en zoombaar
   gradient  verticaal verloop van transparant naar een kleurrol
   text      tekstveld (field) of vaste tekst (text), krimpt tot het in h past
   svg       merkvorm uit /posts/assets, ingekleurd met een kleurrol
   pill      stempel: omlijnd label dat meegroeit met de tekst
   frame     dunne omlijning (rechthoek), lijndikte in stroke

   Regel: geen loze graphics of vaste teksten. Elk element is een veld dat
   je invult of leeg laat, of een bewuste vorm uit het definitieve design.

   Kleurrollen: bg, head, body, label, mark, logo. */

export const COLORS = {
  'binck-black':   { hex: '#101310', name: 'Binck Black' },
  'urban-pine':    { hex: '#556655', name: 'Urban Pine' },
  'concrete-moss': { hex: '#758370', name: 'Concrete Moss' },
  'mist-green':    { hex: '#DCEBDA', name: 'Mist Green' },
  'sage-stone':    { hex: '#8B8B7E', name: 'Sage Stone' },
  'cement-grey':   { hex: '#D4D4CF', name: 'Cement Grey' },
  'cloud-white':   { hex: '#F1F1EB', name: 'Cloud White' },
  'brick-red':     { hex: '#763232', name: 'Brick Red' },
  'golden-yellow': { hex: '#CAA24B', name: 'Golden Yellow' },
  'midnight-plum': { hex: '#47324F', name: 'Midnight Plum' }
};

/* Basissets. Per template kun je rollen overschrijven, zie pal(). */
const BASE = {
  donker: { name: 'Binck Black', bg: 'binck-black', head: 'mist-green', body: 'mist-green', label: 'golden-yellow', mark: 'golden-yellow', logo: 'cloud-white' },
  pine:   { name: 'Urban Pine', bg: 'urban-pine', head: 'mist-green', body: 'mist-green', label: 'golden-yellow', mark: 'mist-green', logo: 'mist-green' },
  licht:  { name: 'Mist Green', bg: 'mist-green', head: 'binck-black', body: 'binck-black', label: 'binck-black', mark: 'binck-black', logo: 'binck-black' },
  wit:    { name: 'Cloud White', bg: 'cloud-white', head: 'binck-black', body: 'binck-black', label: 'sage-stone', mark: 'binck-black', logo: 'binck-black' },
  brick:  { name: 'Brick Red', bg: 'brick-red', head: 'cloud-white', body: 'cloud-white', label: 'cloud-white', mark: 'golden-yellow', logo: 'cloud-white' },
  plum:   { name: 'Midnight Plum', bg: 'midnight-plum', head: 'mist-green', body: 'mist-green', label: 'golden-yellow', mark: 'golden-yellow', logo: 'mist-green' }
};

function pal(id, over) {
  return Object.assign({ id }, BASE[id], over || {});
}

/* Sets voor tekst direct op een foto: alleen de tekstkleur verschilt. */
function opBeeld(id, color) {
  return { id, name: COLORS[color].name, swatch: color, bg: 'binck-black', head: color, body: color, label: color, mark: color, logo: color };
}

/* Typografie uit Figma. ls is letterspatiëring als fractie van de korpsgrootte. */
const EYEBROW = { font: 'mori-semibold', size: 22, lh: 1.2, ls: 0.18, upper: true };

export const FORMATS = {
  feed:     { id: 'feed', name: 'Feed', ratio: '4:5', w: 1080, h: 1350 },
  story:    { id: 'story', name: 'Story', ratio: '9:16', w: 1080, h: 1920 },
  carousel: { id: 'carousel', name: 'Carrousel', ratio: '4:5', w: 1080, h: 1350, slidesOf: 'feed' }
};

export const TEMPLATES = [
  /* ---------- Beeld ---------- */
  {
    id: 'mijlpaal-midden',
    name: 'Titel op beeld',
    group: 'Beeld',
    note: 'Definitief (Figma, pagina Final).',
    fields: [{ key: 'kop', label: 'Kop', def: 'De bouw\nvan Skymark\nis begonnen.', multiline: true }],
    media: [{ key: 'foto', label: 'Beeld of video' }],
    palettes: [opBeeld('op-pine', 'urban-pine'), opBeeld('op-mist', 'mist-green'), opBeeld('op-wit', 'cloud-white'), opBeeld('op-zwart', 'binck-black')],
    layouts: {
      feed: [
        { t: 'fill', color: 'bg' },
        { t: 'media', slot: 'foto', x: 0, y: 0, w: 1080, h: 1350 },
        { t: 'text', field: 'kop', x: 70, y: 400, w: 940, h: 550, valign: 'middle', align: 'center', color: 'head', font: 'talisman-light', size: 82, lh: 1.12, ls: -0.03, min: 56 }
      ],
      story: [
        { t: 'fill', color: 'bg' },
        { t: 'media', slot: 'foto', x: 0, y: 0, w: 1080, h: 1920 },
        { t: 'text', field: 'kop', x: 70, y: 685, w: 940, h: 550, valign: 'middle', align: 'center', color: 'head', font: 'talisman-light', size: 88, lh: 1.12, ls: -0.03, min: 56 }
      ]
    }
  },
  {
    id: 'statement-beeld',
    name: 'Statement op beeld',
    group: 'Beeld',
    note: 'Definitief (Figma, pagina Final).',
    fields: [
      { key: 'statement', label: 'Statement', def: 'Under construction,\nabove expectations.', multiline: true },
      { key: 'onderregel', label: 'Onderregel', def: 'De bouw van Skymark is begonnen.' }
    ],
    media: [{ key: 'foto', label: 'Beeld of video' }],
    palettes: [opBeeld('op-wit', 'cloud-white'), opBeeld('op-mist', 'mist-green'), opBeeld('op-zwart', 'binck-black')],
    layouts: {
      feed: [
        { t: 'fill', color: 'bg' },
        { t: 'media', slot: 'foto', x: 0, y: 0, w: 1080, h: 1350 },
        { t: 'text', field: 'statement', x: 90, y: 400, w: 900, h: 550, valign: 'middle', align: 'center', color: 'head', font: 'talisman-light', size: 88, lh: 1.15, ls: -0.03, min: 56 },
        { t: 'text', field: 'onderregel', x: 90, y: 1190, w: 900, h: 27, align: 'center', color: 'label', ...EYEBROW }
      ],
      story: [
        { t: 'fill', color: 'bg' },
        { t: 'media', slot: 'foto', x: 0, y: 0, w: 1080, h: 1920 },
        { t: 'text', field: 'statement', x: 90, y: 685, w: 900, h: 550, valign: 'middle', align: 'center', color: 'head', font: 'talisman-light', size: 88, lh: 1.15, ls: -0.03, min: 56 },
        { t: 'text', field: 'onderregel', x: 90, y: 1600, w: 900, h: 27, align: 'center', color: 'label', ...EYEBROW }
      ]
    }
  },
  {
    id: 'passe-partout',
    name: 'Passe-partout',
    group: 'Beeld',
    note: 'Beeld of video met een rand, kop eronder.',
    fields: [
      { key: 'eyebrow', label: 'Bovenregel', def: 'Under construction, above expectations.' },
      { key: 'kop', label: 'Kop', def: 'De bouw van Skymark is begonnen.', multiline: true }
    ],
    media: [{ key: 'foto', label: 'Beeld of video' }],
    palettes: [pal('wit'), pal('licht', { label: 'urban-pine' }), pal('donker', { label: 'sage-stone' }), pal('pine', { label: 'mist-green' })],
    layouts: {
      feed: [
        { t: 'fill', color: 'bg' },
        { t: 'media', slot: 'foto', x: 90, y: 90, w: 900, h: 1020 },
        { t: 'text', field: 'eyebrow', x: 90, y: 1160, w: 900, h: 24, color: 'label', ...EYEBROW, size: 18, lh: 1.3 },
        { t: 'text', field: 'kop', x: 90, y: 1200, w: 900, h: 116, color: 'head', font: 'talisman-light', size: 48, lh: 1.2, ls: -0.02, min: 36 }
      ],
      story: [
        { t: 'fill', color: 'bg' },
        { t: 'media', slot: 'foto', x: 90, y: 90, w: 900, h: 1440 },
        { t: 'text', field: 'eyebrow', x: 90, y: 1590, w: 900, h: 24, color: 'label', ...EYEBROW, size: 18, lh: 1.3 },
        { t: 'text', field: 'kop', x: 90, y: 1630, w: 900, h: 120, color: 'head', font: 'talisman-light', size: 52, lh: 1.15, ls: -0.02, min: 38 }
      ]
    }
  },
  {
    id: 'mijlpaal-onder',
    name: 'Titel onder op beeld',
    group: 'Beeld',
    note: 'Beeld vol, verloop en kop onderin.',
    fields: [{ key: 'kop', label: 'Kop', def: 'Under construction,\nabove expectations.', multiline: true }],
    media: [{ key: 'foto', label: 'Beeld of video' }],
    palettes: [pal('donker'), pal('pine'), pal('plum')],
    layouts: {
      feed: [
        { t: 'fill', color: 'bg' },
        { t: 'media', slot: 'foto', x: 0, y: 0, w: 1080, h: 1350 },
        { t: 'gradient', x: 0, y: 790, w: 1080, h: 560, color: 'bg', from: 0, to: 0.78 },
        { t: 'text', field: 'kop', x: 72, y: 880, w: 940, h: 342, valign: 'bottom', color: 'head', font: 'talisman-light', size: 92, lh: 1.12, ls: -0.03, min: 60 }
      ],
      story: [
        { t: 'fill', color: 'bg' },
        { t: 'media', slot: 'foto', x: 0, y: 0, w: 1080, h: 1920 },
        { t: 'gradient', x: 0, y: 1220, w: 1080, h: 700, color: 'bg', from: 0, to: 0.8 },
        { t: 'text', field: 'kop', x: 72, y: 1420, w: 940, h: 346, valign: 'bottom', color: 'head', font: 'talisman-light', size: 92, lh: 1.12, ls: -0.03, min: 60 }
      ]
    }
  },
  {
    id: 'maker',
    name: 'De Binckhorst Maakt',
    group: 'Beeld',
    fields: [
      { key: 'stempel', label: 'Stempel', def: 'De Binckhorst maakt' },
      { key: 'naam', label: 'Naam', def: 'Naam van de maker' },
      { key: 'wat', label: 'Omschrijving', def: 'Wat die maakt, en waar in de Binckhorst', multiline: true }
    ],
    media: [{ key: 'foto', label: 'Beeld of video' }],
    palettes: [pal('donker', { label: 'mist-green', body: 'sage-stone' }), pal('pine', { label: 'mist-green' }), pal('plum', { label: 'mist-green' })],
    layouts: {
      feed: [
        { t: 'fill', color: 'bg' },
        { t: 'media', slot: 'foto', x: 0, y: 0, w: 1080, h: 1010 },
        { t: 'pill', field: 'stempel', x: 72, y: 72, h: 67, padX: 30, stroke: 2, color: 'label', ...EYEBROW },
        { t: 'text', field: 'naam', x: 72, y: 1062, w: 936, h: 100, color: 'head', font: 'talisman-light', size: 72, lh: 1.15, ls: -0.03, min: 48 },
        { t: 'text', field: 'wat', x: 72, y: 1186, w: 900, h: 92, color: 'body', font: 'mori-book', size: 32, lh: 1.4, ls: -0.02, min: 26 }
      ]
    }
  },

  /* ---------- Tekst ---------- */
  {
    id: 'quote',
    name: 'Quote',
    group: 'Tekst',
    note: 'Definitief (Figma, pagina Final).',
    fields: [
      { key: 'quote', label: 'Quote', def: '“Hier komt de quote van de architect over de keuze voor deze vorm.”', multiline: true },
      { key: 'naam', label: 'Naam', def: 'Naam architect · De Zwarte Hond' }
    ],
    media: [],
    palettes: [pal('brick'), pal('donker', { label: 'mist-green' }), pal('plum', { label: 'mist-green' }), pal('pine', { label: 'mist-green' })],
    layouts: {
      feed: [
        { t: 'fill', color: 'bg' },
        { t: 'text', field: 'quote', x: 72, y: 320, w: 930, h: 660, color: 'head', font: 'talisman-light', size: 72, lh: 1.28, ls: -0.01, min: 48 },
        { t: 'text', field: 'naam', x: 72, y: 1090, w: 936, h: 27, color: 'label', ...EYEBROW }
      ],
      story: [
        { t: 'fill', color: 'bg' },
        { t: 'text', field: 'quote', x: 72, y: 560, w: 930, h: 860, color: 'head', font: 'talisman-light', size: 76, lh: 1.28, ls: -0.01, min: 50 },
        { t: 'text', field: 'naam', x: 72, y: 1500, w: 936, h: 27, color: 'label', ...EYEBROW }
      ]
    }
  },
  {
    id: 'outro',
    name: 'Statement',
    group: 'Tekst',
    fields: [
      { key: 'statement', label: 'Statement', def: 'A quiet place above the noise.', multiline: true },
      { key: 'cta', label: 'Onderregel', def: 'Volg skymark.denhaag' }
    ],
    media: [],
    palettes: [pal('donker'), pal('pine'), pal('licht', { label: 'urban-pine' }), pal('brick', { label: 'golden-yellow' }), pal('plum')],
    layouts: {
      feed: [
        { t: 'fill', color: 'bg' },
        { t: 'text', field: 'statement', x: 90, y: 400, w: 900, h: 550, valign: 'middle', align: 'center', color: 'head', font: 'talisman-light', size: 88, lh: 1.15, ls: -0.03, min: 56 },
        { t: 'text', field: 'cta', x: 90, y: 1190, w: 900, h: 27, align: 'center', color: 'label', ...EYEBROW }
      ],
      story: [
        { t: 'fill', color: 'bg' },
        { t: 'text', field: 'statement', x: 90, y: 685, w: 900, h: 550, valign: 'middle', align: 'center', color: 'head', font: 'talisman-light', size: 88, lh: 1.15, ls: -0.03, min: 56 },
        { t: 'text', field: 'cta', x: 90, y: 1600, w: 900, h: 27, align: 'center', color: 'label', ...EYEBROW }
      ]
    }
  },
  {
    id: 'hotspot',
    name: 'Hotspot Guide',
    group: 'Tekst',
    fields: [
      { key: 'label', label: 'Label', def: 'Alleen voor Skymark-inschrijvers' },
      { key: 'kop', label: 'Kop', def: 'Ontdek nu al je toekomstige buurt.', multiline: true },
      { key: 'tekst', label: 'Tekst', def: 'Van koffietent tot kade. Dit ligt straks om de hoek.', multiline: true },
      { key: 'cta', label: 'Actie', def: 'Ontdek de guide →' }
    ],
    media: [],
    palettes: [pal('licht'), pal('wit'), pal('pine', { label: 'golden-yellow' })],
    layouts: {
      feed: [
        { t: 'fill', color: 'bg' },
        { t: 'text', field: 'label', x: 72, y: 96, w: 936, h: 27, color: 'label', ...EYEBROW },
        { t: 'text', field: 'kop', x: 72, y: 400, w: 900, h: 400, color: 'head', font: 'talisman-light', size: 100, lh: 1.12, ls: -0.03, min: 64 },
        { t: 'text', field: 'tekst', x: 72, y: 860, w: 800, h: 230, color: 'body', font: 'mori-book', size: 38, lh: 1.5, ls: -0.02, min: 28 },
        { t: 'text', field: 'cta', x: 72, y: 1190, w: 936, h: 32, color: 'label', ...EYEBROW, size: 26 }
      ]
    }
  },

  /* ---------- Feitjes ---------- */
  {
    id: 'feitje-vraag',
    name: 'Feitje · vraag',
    group: 'Feitjes',
    note: 'Definitief (Figma, pagina Final).',
    fields: [
      { key: 'label', label: 'Label', def: 'Feitjes over het gebouw' },
      { key: 'vraag', label: 'Vraag', def: 'Hoe hoog wordt Skymark?', multiline: true }
    ],
    media: [],
    palettes: [pal('pine'), pal('donker', { mark: 'mist-green' }), pal('plum', { mark: 'mist-green' })],
    layouts: {
      feed: [
        { t: 'fill', color: 'bg' },
        { t: 'svg', asset: 'boog-boven', x: 474, y: 8, w: 131, h: 46, color: 'mark' },
        { t: 'text', field: 'label', x: 90, y: 519, w: 900, h: 27, align: 'center', color: 'label', ...EYEBROW },
        { t: 'text', field: 'vraag', x: 90, y: 589, w: 900, h: 340, align: 'center', color: 'head', font: 'talisman-light', size: 110, lh: 1.1, ls: -0.03, min: 72 },
        { t: 'svg', asset: 'boog-onder', x: 474, y: 1296, w: 131, h: 46, color: 'mark' }
      ]
    }
  },
  {
    id: 'feitje-antwoord',
    name: 'Feitje · antwoord',
    group: 'Feitjes',
    note: 'Definitief (Figma, pagina Final).',
    fields: [
      { key: 'getal', label: 'Getal', def: '101 m' },
      { key: 'uitleg', label: 'Uitleg', def: 'Ruim twee keer zo hoog als het reuzenrad op de Pier.', multiline: true }
    ],
    media: [],
    palettes: [pal('donker', { body: 'sage-stone' }), pal('pine', { body: 'mist-green' }), pal('plum', { body: 'mist-green' })],
    layouts: {
      feed: [
        { t: 'fill', color: 'bg' },
        { t: 'text', field: 'getal', x: 70, y: 330, w: 940, h: 515, valign: 'middle', align: 'center', nowrap: true, color: 'head', font: 'talisman-compressed', size: 560, lh: 0.92, ls: 0, min: 160 },
        { t: 'text', field: 'uitleg', x: 140, y: 1040, w: 800, h: 112, align: 'center', color: 'body', font: 'mori-book', size: 40, lh: 1.4, ls: -0.02, min: 30 }
      ]
    }
  },
  {
    id: 'feitje-licht',
    name: 'Feitje · getal licht',
    group: 'Feitjes',
    note: 'Definitief (Figma, pagina Final).',
    fields: [
      { key: 'label', label: 'Label', def: 'Feitjes over het gebouw' },
      { key: 'getal', label: 'Getal', def: '39.000' },
      { key: 'uitleg', label: 'Uitleg', def: 'vierkante meter, alle verdiepingen bij elkaar', multiline: true }
    ],
    media: [],
    palettes: [pal('licht'), pal('wit'), pal('pine', { label: 'mist-green', mark: 'mist-green' })],
    layouts: {
      feed: [
        { t: 'fill', color: 'bg' },
        { t: 'frame', x: 70, y: 70, w: 940, h: 1210, stroke: 2, color: 'mark' },
        { t: 'text', field: 'label', x: 90, y: 130, w: 900, h: 24, align: 'center', color: 'label', font: 'mori-semibold', size: 20, lh: 1.2, ls: 0.2, upper: true },
        { t: 'text', field: 'getal', x: 90, y: 400, w: 900, h: 396, valign: 'middle', align: 'center', nowrap: true, color: 'head', font: 'talisman-compressed', size: 430, lh: 0.92, ls: 0, min: 140 },
        { t: 'text', field: 'uitleg', x: 190, y: 860, w: 700, h: 130, align: 'center', color: 'body', font: 'talisman-light', size: 48, lh: 1.3, ls: -0.02, min: 34 }
      ]
    }
  },
  {
    id: 'feitje-beeld',
    name: 'Feitje · beeld',
    group: 'Feitjes',
    fields: [{ key: 'bijschrift', label: 'Bijschrift', def: 'Een nieuw perspectief op een vertrouwde stad.', multiline: true }],
    media: [{ key: 'foto', label: 'Beeld of video' }],
    palettes: [pal('donker'), pal('pine'), pal('plum')],
    layouts: {
      feed: [
        { t: 'fill', color: 'bg' },
        { t: 'media', slot: 'foto', x: 0, y: 0, w: 1080, h: 1080 },
        { t: 'text', field: 'bijschrift', x: 72, y: 1128, w: 936, h: 174, valign: 'middle', color: 'head', font: 'mori-book', size: 36, lh: 1.4, ls: -0.02, min: 28 }
      ]
    }
  },

  /* ---------- Verhaal ---------- */
  {
    id: 'ontwerp-cover',
    name: 'Ontwerpverhaal · cover',
    group: 'Verhaal',
    fields: [
      { key: 'label', label: 'Label', def: 'Het ontwerpverhaal' },
      { key: 'kop', label: 'Kop', def: 'Waarom kreeg Skymark een kroon?', multiline: true }
    ],
    media: [{ key: 'foto', label: 'Beeld of video' }],
    palettes: [pal('donker'), pal('pine'), pal('plum')],
    layouts: {
      feed: [
        { t: 'fill', color: 'bg' },
        { t: 'media', slot: 'foto', x: 0, y: 0, w: 1080, h: 860 },
        { t: 'text', field: 'label', x: 72, y: 930, w: 936, h: 27, color: 'label', ...EYEBROW },
        { t: 'text', field: 'kop', x: 72, y: 1000, w: 940, h: 260, color: 'head', font: 'talisman-light', size: 84, lh: 1.12, ls: -0.03, min: 56 }
      ]
    }
  },
  {
    id: 'ontwerp-uitleg',
    name: 'Ontwerpverhaal · uitleg',
    group: 'Verhaal',
    fields: [
      { key: 'label', label: 'Label', def: 'Het ontwerpverhaal' },
      { key: 'kop', label: 'Kop', def: 'De top bepaalt hoe je de toren van een afstand ziet.', multiline: true },
      { key: 'tekst', label: 'Tekst', def: 'De Zwarte Hond ontwierp een subtiele kroon die Skymark herkenbaar maakt in de Haagse skyline.', multiline: true }
    ],
    media: [],
    palettes: [pal('licht'), pal('wit'), pal('pine', { label: 'golden-yellow' })],
    layouts: {
      feed: [
        { t: 'fill', color: 'bg' },
        { t: 'text', field: 'label', x: 72, y: 96, w: 936, h: 27, color: 'label', ...EYEBROW },
        { t: 'text', field: 'kop', x: 72, y: 380, w: 920, h: 400, color: 'head', font: 'talisman-light', size: 84, lh: 1.15, ls: -0.03, min: 56 },
        { t: 'text', field: 'tekst', x: 72, y: 880, w: 820, h: 290, color: 'body', font: 'mori-book', size: 38, lh: 1.5, ls: -0.02, min: 28 }
      ]
    }
  }
];

export function getTemplate(id) {
  return TEMPLATES.find(t => t.id === id) || TEMPLATES[0];
}

export function templatesFor(formatId) {
  const f = formatId === 'carousel' ? 'feed' : formatId;
  return TEMPLATES.filter(t => t.layouts[f]);
}

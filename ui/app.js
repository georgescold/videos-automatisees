/* Interface de l'usine a videos. Vanilla, aucun build.
   Design system : voir DESIGN.md a la racine. */

const $ = (id) => document.getElementById(id);

const state = {
  scripts: [],
  status: null,
  slug: null,
  doc: null,
  dirty: false,
  jobId: null,
  source: null,
  running: false,
  music: null,
  musicAttribution: null,
  mode: 'edit',
  editorView: 'texte', // texte | beats
  activeChannel: 'amour',
  libTab: 'scripts', // scripts | history
  history: [],
  fullTextEdited: false,
  voiceMode: 'tts', // tts | mine | sts
  ttsEngine: 'elevenlabs', // elevenlabs | xtts
  voicesLoaded: null, // « langue:jeu » deja charge
  voiceLanguage: 'fr',
  voiceSet: 'selection', // selection maison | tout le catalogue
  // Voix mises en etoile : elles remontent en tete de liste. Memorise dans le
  // navigateur de chaque machine.
  favs: new Set(JSON.parse(localStorage.getItem('voiceFavs') ?? '[]')),
  voices: [], // catalogue : voix du compte + bibliotheque
  emotions: null, // intonation retenue par beat (declaree ou deduite)
  keys: null, // trousseau ElevenLabs + quotas
  quota: null, // verification du quota pour le script ouvert
};

const fmt = (n) => Number(n ?? 0).toLocaleString('fr-FR');

const DIACRITICS = /[̀-ͯ]/g;

const slugify = (str) =>
  str
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);

const api = async (url, options = {}) => {
  const res = await fetch(url, options);
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error ?? `Erreur ${res.status}`);
  return data;
};

const escapeHtml = (str) =>
  String(str).replace(/[&<>"']/g, (c) =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]),
  );

let toastTimer = null;
const toast = (message, bad = false) => {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.textContent = message;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), bad ? 8000 : 3500);
};

const debounce = (fn, ms) => {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

/** Confirmation en deux temps, sans dialogue bloquant. */
const armed = new Map();
const confirmTwice = (key, message) => {
  if (armed.get(key)) {
    clearTimeout(armed.get(key));
    armed.delete(key);
    return true;
  }
  toast(message, true);
  armed.set(key, setTimeout(() => armed.delete(key), 5000));
  return false;
};

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const applyTheme = (theme) => {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
};

applyTheme(
  localStorage.getItem('theme') ??
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
);

$('theme-toggle').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

// ---------------------------------------------------------------------------
// Statut du projet
// ---------------------------------------------------------------------------
const renderStatus = () => {
  const s = state.status;
  if (!s) return;

  const musicCount = s.music.length;
  const pills = [
    {label: 'Pexels', on: s.pexels, why: 'Visuels automatiques. Sans cette clé, aucune image.'},
    // Voix : verte des qu'une piste est possible (cle ElevenLabs OU voix locale).
    {
      label: 'Voix',
      on: s.elevenLabs || s.whisper,
      why: 'Au moins un moyen de faire la voix off et les sous-titres.',
    },
    {
      label: s.elevenLabsKeys > 1 ? `${s.elevenLabsKeys} clés ElevenLabs` : 'ElevenLabs',
      on: s.elevenLabs,
      optional: true,
      why: 'Facultatif : les voix locales Piper et XTTS ne demandent aucune clé.',
    },
    {
      label:
        musicCount > 1 ? `${musicCount} musiques` : musicCount === 1 ? '1 musique' : 'Aucune musique',
      on: musicCount > 0,
      optional: true,
      why: 'Facultatif : une vidéo peut se passer de musique de fond.',
    },
  ];
  // Une clé facultative absente n'est pas une panne : point gris, pas rouge.
  $('status-pills').innerHTML = pills
    .map(
      (p) =>
        `<span class="pill ${p.on ? 'on' : p.optional ? 'opt' : 'off'}" title="${escapeHtml(p.why)}">${p.label}</span>`,
    )
    .join('');

  const moods = $('music-mood');
  if (moods.options.length === 0) {
    moods.innerHTML = s.moods
      .map((m) => `<option value="${m}">${m.charAt(0).toUpperCase()}${m.slice(1)}</option>`)
      .join('');
  }

  // Voix XTTS (HD locale). Le bouton du moteur est desactive tant que non installe.
  const xttsSel = $('o-xtts-voice');
  if (xttsSel.options.length === 0 && s.xttsVoices?.length) {
    xttsSel.innerHTML = s.xttsVoices
      .map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.label)}</option>`)
      .join('');
  }
  const xttsBtn = $('tts-engine').querySelector('[data-engine=xtts]');
  if (xttsBtn) {
    xttsBtn.disabled = !s.xtts;
    xttsBtn.title = s.xtts ? '' : 'XTTS pas encore installé';
  }

  // Chaines : le selecteur reflete l'etat serveur, une seule chaine active.
  if (s.channels) {
    state.activeChannel = s.channels.active;
    $('channel-select').innerHTML = s.channels.channels
      .map(
        (c) =>
          `<option value="${escapeHtml(c.id)}"${c.id === s.channels.active ? ' selected' : ''}>${escapeHtml(c.name)}</option>`,
      )
      .join('');
  }

  // La musique choisie doit toujours exister sur le disque.
  if (state.music && !s.music.some((m) => m.file === state.music)) setMusic(null);
  if (!state.music && musicCount > 0) {
    setMusic(s.music[0].file, s.music[0].attribution);
  }

  // « Générée » par défaut, sur ElevenLabs dès qu'une clé existe.
  if (!state.voiceModeInitialised) {
    state.voiceModeInitialised = true;
    setTtsEngine(s.elevenLabs ? 'elevenlabs' : 'xtts');
    setVoiceMode('tts');
  }
  renderAudioState();
};

const loadStatus = async () => {
  state.status = await api('/api/status');
  renderStatus();
};

// ---------------------------------------------------------------------------
// Musique
// ---------------------------------------------------------------------------
const setMusic = (file, attribution = null) => {
  state.music = file;
  state.musicAttribution = attribution;
  $('music-name').textContent = file ?? 'Aucune musique';
  $('music-current').classList.toggle('set', Boolean(file));
  $('music-clear').hidden = !file;
  $('music-attribution').hidden = !attribution;
  $('music-attribution').textContent = attribution
    ? `À créditer en description : ${attribution}`
    : '';
  $('music-play').hidden = !file;
  renderCounters();
};

// Ecouter la musique retenue pour la video, sans la chercher dans un dossier.
$('music-play').addEventListener('click', () => {
  if (!state.music) return;
  const audio = $('preview-audio');
  const src = `/music/${encodeURIComponent(state.music)}`;
  if (audio.dataset.id === src && !audio.paused) {
    audio.pause();
    return;
  }
  audio.src = src;
  audio.dataset.id = src;
  audio.volume = 0.8;
  audio.play().catch(() => toast('Lecture impossible', true));
});

// N'importe quel fichier audio a soi : Pixabay, achat, export perso. Le
// fichier part dans public/music et devient la musique de la video.
$('music-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const r = await api(`/api/music/upload?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file,
    });
    await loadStatus();
    setMusic(r.file, null);
    toast(`Musique ajoutée : ${r.file} (${Math.round(r.bytes / 1024)} Ko)`);
  } catch (err) {
    toast(err.message, true);
  }
});

const renderTracks = (tracks) => {
  const list = $('music-results');
  if (tracks.length === 0) {
    list.innerHTML = '<li class="t-name">Aucune piste pour cette recherche.</li>';
    return;
  }

  list.innerHTML = tracks
    .map(
      (t, i) => `<li>
        <button class="icon-btn tiny" data-play="${i}" title="Écouter">▸</button>
        <span class="t-name">${escapeHtml(t.name)}
          <span class="t-meta">${escapeHtml(t.artist)} · ${Math.round(t.duration / 60)} min · ${escapeHtml(t.license)}</span>
        </span>
        <button class="btn small" data-pick="${i}">Choisir</button>
      </li>`,
    )
    .join('');

  const audio = $('preview-audio');

  for (const button of list.querySelectorAll('[data-play]')) {
    button.addEventListener('click', () => {
      const track = tracks[Number(button.dataset.play)];
      if (audio.dataset.id === track.id && !audio.paused) {
        audio.pause();
        return;
      }
      audio.src = track.preview;
      audio.dataset.id = track.id;
      audio.volume = 0.7;
      audio.play().catch(() => toast('Écoute impossible', true));
    });
  }

  for (const button of list.querySelectorAll('[data-pick]')) {
    button.addEventListener('click', async () => {
      const track = tracks[Number(button.dataset.pick)];
      button.disabled = true;
      button.textContent = '...';
      try {
        const {file} = await api('/api/music/download', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify(track),
        });
        await loadStatus();
        setMusic(file, track.attribution);
        $('music-panel').hidden = true;
        audio.pause();
        toast('Musique téléchargée dans public/music');
      } catch (err) {
        toast(err.message, true);
      } finally {
        button.disabled = false;
        button.textContent = 'Choisir';
      }
    });
  }
};

const searchMusic = async () => {
  const button = $('music-search');
  button.disabled = true;
  button.textContent = 'Recherche...';
  try {
    const tracks = await api(
      `/api/music/search?mood=${encodeURIComponent($('music-mood').value)}` +
        `&q=${encodeURIComponent($('music-query').value)}`,
    );
    renderTracks(tracks);
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Chercher';
  }
};

$('music-mood').addEventListener('change', searchMusic);

$('music-browse').addEventListener('click', () => {
  const panel = $('music-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden && $('music-results').children.length === 0) searchMusic();
});

$('music-search').addEventListener('click', searchMusic);
$('music-query').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchMusic();
});
$('music-clear').addEventListener('click', () => setMusic(null));

$('o-volume').addEventListener('input', () => {
  $('volume-value').textContent = `${$('o-volume').value} %`;
});

// Le recapitulatif suit le format choisi. (Fleche obligatoire : renderCounters
// est declare plus bas, le referencer directement ici planterait au chargement.)
$('o-format').addEventListener('change', () => renderCounters());

$('o-media').addEventListener('change', () => {
  const notes = {
    mix: "La vidéo passe en premier sur chaque beat. La photo prend le relais quand Pexels ne rend rien d'exploitable.",
    video: 'Uniquement des vidéos. Un beat sans résultat vidéo restera sans visuel.',
    photo: 'Uniquement des photos, animées par un mouvement de caméra lent.',
  };
  $('media-note').textContent = notes[$('o-media').value];
});

// ---------------------------------------------------------------------------
// Liste des scripts
// ---------------------------------------------------------------------------
const renderScriptList = () => {
  const list = $('script-list');
  // Chaque chaine ne voit que ses scripts.
  const visibles = state.scripts.filter((s) => (s.channel ?? 'amour') === state.activeChannel);
  if (visibles.length === 0) {
    list.innerHTML = "<li class=\"hint\" style=\"border:0;padding:0;margin:0\">Aucun script pour l'instant.</li>";
    return;
  }

  list.innerHTML = visibles
    .map((s) => {
      const meta = s.error
        ? `<span class="s-meta">${escapeHtml(s.error)}</span>`
        : `<span class="s-meta">${s.beats} beats · ${s.words} mots · ${s.estimatedSeconds} s` +
          (s.hasAudio ? ' <span class="badge">voix</span>' : '') +
          (s.renders?.length ? ' <span class="badge">rendu</span>' : '') +
          '</span>';
      return `<li><button data-slug="${escapeHtml(s.slug)}" class="${s.slug === state.slug ? 'active' : ''}">
        <span class="s-title">${escapeHtml(s.title)}</span>${meta}</button></li>`;
    })
    .join('');

  for (const button of list.querySelectorAll('button')) {
    button.addEventListener('click', () => openScript(button.dataset.slug));
  }
};

const loadScripts = async () => {
  state.scripts = await api('/api/scripts');
  renderScriptList();
};

// ---------------------------------------------------------------------------
// Editeur
// ---------------------------------------------------------------------------
const markDirty = (dirty = true) => {
  state.dirty = dirty;
  $('dirty-flag').hidden = !dirty;
};

const countWords = () =>
  (state.doc?.beats ?? [])
    .map((b) => String(b.text ?? '').trim())
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;

/** Ce que build.mjs refusera : signale ici avant de lancer la production. */
const scriptIssues = () => {
  if (state.mode === 'import') {
    return ['import non terminé, clique sur « Découper et créer »'];
  }
  if (state.mode !== 'edit' || !state.doc) return ['aucun script ouvert'];
  const beats = state.doc.beats ?? [];
  const issues = [];
  if (!$('f-title').value.trim()) issues.push('titre manquant');
  if (beats.length === 0) issues.push('aucun beat');
  const plural = (n) => (n > 1 ? 's' : '');
  const noText = beats.filter((b) => !String(b.text ?? '').trim()).length;
  const noQuery = beats.filter((b) => !String(b.visual_query ?? '').trim()).length;
  if (noText > 0) issues.push(`${noText} beat${plural(noText)} sans texte`);
  if (noQuery > 0) issues.push(`${noQuery} beat${plural(noQuery)} sans requête visuelle`);

  // Contraintes propres au mode de voix off choisi.
  const meta = currentScriptMeta();
  const s = state.status ?? {};
  if (state.voiceMode === 'tts' && state.ttsEngine === 'elevenlabs') {
    const voice = selectedVoice();
    if (!s.elevenLabs) {
      issues.push('ElevenLabs : aucune clé stockée (ou choisis « Locale HD »)');
    } else if (voice && voice.requiresPaid && !s.elevenLabsPaid && willSynthesize()) {
      // Voix de bibliotheque sans aucun compte payant = refus garanti (402).
      issues.push(`« ${voice.name} » demande un plan payant`);
    } else if (willSynthesize() && state.quota && !state.quota.ok) {
      // Le quota des comptes ne couvre pas la voix off : autant le dire ici
      // plutot que de laisser la production echouer a mi-chemin.
      issues.push(`quota ElevenLabs insuffisant (${fmt(state.quota.needed)} crédits nécessaires)`);
    }
  }
  if (state.voiceMode === 'tts' && state.ttsEngine === 'xtts') {
    if (!s.xtts) issues.push('XTTS pas encore installé');
    if ($('o-xtts-clone').checked && !meta?.hasRawVoice) {
      issues.push('clonage : dépose un échantillon de ta voix (mode « Ma voix »)');
    }
  }
  // Les voix locales Piper/XTTS ne demandent aucune clé.
  if (state.voiceMode === 'mine' && !meta?.hasAudio) {
    issues.push('dépose ton enregistrement');
  }
  if (state.voiceMode === 'sts') {
    if (!meta?.hasAudio) issues.push('dépose ta voix à relooker');
    if (!s.elevenLabs) issues.push('speech-to-speech : clé ElevenLabs absente');
    if (s.elevenLabs && !$('o-sts-voice').value) issues.push('choisis la voix cible');
  }
  return issues;
};

/** Le texte des beats, d'un seul tenant : ce que la voix lira vraiment. */
const joinedText = (beats) =>
  (beats ?? [])
    .map((b) => String(b.text ?? '').trim())
    .filter(Boolean)
    .join(' ');

/**
 * Vue « Texte » : le script entier, modifiable. C'est la vue par defaut, parce
 * qu'on relit un script d'un seul tenant, pas phrase par phrase.
 */
const renderFullText = () => {
  const zone = $('fulltext');
  // Ne jamais ecraser ce que l'utilisateur est en train d'ecrire.
  if (!state.fullTextEdited) zone.value = joinedText(state.doc?.beats);

  const text = zone.value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  $('fulltext-stats').textContent =
    `${words} mot${words > 1 ? 's' : ''} · ${text.length} caractères · environ ${Math.round(words / 2.5)} s`;

  $('fulltext-apply').hidden = !state.fullTextEdited;
  $('fulltext-warn').hidden = !state.fullTextEdited;
  if (state.fullTextEdited) {
    $('fulltext-warn').textContent =
      'Texte modifié. « Appliquer au découpage » refait les beats : les phrases inchangées ' +
      'gardent leur image et leur intonation, les nouvelles en reçoivent de nouvelles.';
  }
};

const setEditorView = (view) => {
  state.editorView = view;
  for (const btn of $('editor-view').querySelectorAll('.seg-btn')) {
    btn.classList.toggle('active', btn.dataset.view === view);
  }
  $('pane-texte').hidden = view !== 'texte';
  $('pane-beats').hidden = view !== 'beats';
  if (view === 'texte') renderFullText();
};

for (const btn of $('editor-view').querySelectorAll('.seg-btn')) {
  btn.addEventListener('click', () => setEditorView(btn.dataset.view));
}

$('fulltext').addEventListener('input', () => {
  state.fullTextEdited = true;
  renderFullText();
});

/**
 * Redecoupe le texte en beats. Une phrase qui n'a pas bouge garde son image et
 * son intonation : sans ca, corriger une virgule couterait tout le travail
 * d'habillage du script.
 */
const applyFullText = async () => {
  const text = $('fulltext').value;
  if (!text.trim()) return toast('Le texte est vide', true);

  const button = $('fulltext-apply');
  button.disabled = true;
  try {
    // Le serveur recale sur les beats enregistres : seuls les passages
    // reellement modifies sont redecoupes.
    const {beats, preserved, created} = await api('/api/resegment', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({slug: state.slug, text}),
    });

    state.doc.beats = beats;
    state.fullTextEdited = false;
    markDirty();
    renderBeats();
    renderFullText();
    toast(
      created === 0
        ? `${beats.length} beats, tous conservés.`
        : `${preserved} beat${preserved > 1 ? 's' : ''} intact${preserved > 1 ? 's' : ''}, ${created} nouveau${created > 1 ? 'x' : ''} à habiller dans la vue Beats.`,
    );
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
  }
};

$('fulltext-apply').addEventListener('click', applyFullText);

const renderCounters = () => {
  const beats = state.doc?.beats ?? [];
  const words = countWords();
  $('c-beats').textContent = `${beats.length} beat${beats.length > 1 ? 's' : ''}`;
  $('c-words').textContent = `${words} mot${words > 1 ? 's' : ''}`;
  $('c-duration').textContent = `environ ${Math.round(words / 2.5)} s`;

  renderFullText();

  const issues = scriptIssues();
  const banner = $('issues');
  banner.hidden = issues.length === 0;
  banner.textContent =
    issues.length > 0 ? `À compléter avant de produire : ${issues.join(', ')}.` : '';
  $('produce').disabled = issues.length > 0 || state.running;
  renderRecap();
};

const renderBeats = () => {
  const list = $('beats');
  const beats = state.doc.beats;
  const emotions = state.status?.emotions ?? [];

  list.innerHTML = beats
    .map((beat, i) => {
      const query = String(beat.visual_query ?? '').trim();
      const dup = i > 0 && query && String(beats[i - 1].visual_query ?? '').trim() === query;
      // Intonation : celle du script, sinon celle deduite du texte, affichee
      // en clair pour que rien ne parte « au hasard ».
      const chosen = String(beat.emotion ?? '');
      const auto = state.emotions?.[i];
      const autoLabel = emotions.find((e) => e.id === auto?.emotion)?.label ?? '…';
      const options = emotions
        .map(
          (e) =>
            `<option value="${escapeHtml(e.id)}"${e.id === chosen ? ' selected' : ''}>${escapeHtml(e.label)}</option>`,
        )
        .join('');
      return `<li class="beat">
        <span class="beat-n">${i + 1}</span>
        <div class="beat-fields">
          <textarea rows="2" data-i="${i}" data-k="text" placeholder="Phrase dite à voix haute, en français">${escapeHtml(beat.text ?? '')}</textarea>
          <input type="text" class="query${dup ? ' warn' : ''}" data-i="${i}" data-k="visual_query"
                 placeholder="requête Pexels, en anglais" value="${escapeHtml(query)}"
                 title="${dup ? 'Identique au beat précédent : le montage va se répéter' : 'Décris une scène filmable, en anglais'}" />
          <div class="beat-tone">
            <select data-i="${i}" data-k="emotion" title="Intonation de la voix sur ce beat">
              <option value=""${chosen ? '' : ' selected'}>Automatique${chosen ? '' : ` — ${escapeHtml(autoLabel)}`}</option>
              ${options}
            </select>
          </div>
        </div>
        <div class="beat-tools">
          <button data-act="up" data-i="${i}" title="Monter" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button data-act="down" data-i="${i}" title="Descendre" ${i === beats.length - 1 ? 'disabled' : ''}>↓</button>
          <button data-act="del" data-i="${i}" title="Supprimer">×</button>
        </div>
      </li>`;
    })
    .join('');

  for (const input of list.querySelectorAll('[data-k]')) {
    input.addEventListener('input', () => {
      state.doc.beats[Number(input.dataset.i)][input.dataset.k] = input.value;
      markDirty();
      renderCounters();
    });
    if (input.dataset.k === 'visual_query') {
      input.addEventListener('change', () => renderBeats());
    }
    if (input.dataset.k === 'emotion') {
      input.addEventListener('change', () => {
        const beat = state.doc.beats[Number(input.dataset.i)];
        // Vide = on laisse l'usine deduire l'intonation du texte.
        if (input.value) beat.emotion = input.value;
        else delete beat.emotion;
        markDirty();
        // Les balises comptent dans le quota : le devis change avec elles.
        refreshQuota();
      });
    }
  }

  for (const button of list.querySelectorAll('[data-act]')) {
    button.addEventListener('click', () => {
      const i = Number(button.dataset.i);
      const act = button.dataset.act;
      if (act === 'del') state.doc.beats.splice(i, 1);
      if (act === 'up') state.doc.beats.splice(i - 1, 0, state.doc.beats.splice(i, 1)[0]);
      if (act === 'down') state.doc.beats.splice(i + 1, 0, state.doc.beats.splice(i, 1)[0]);
      markDirty();
      renderBeats();
    });
  }

  renderCounters();
};

const showMode = (mode) => {
  state.mode = mode;
  $('editor-empty').hidden = mode !== 'empty';
  $('editor-body').hidden = mode !== 'edit';
  $('import-body').hidden = mode !== 'import';
};

const renderEditor = () => {
  showMode('edit');
  $('editor-slug').textContent = state.slug;
  $('f-title').value = state.doc.title ?? '';
  $('f-hook').value = state.doc.hook ?? '';

  const yt = state.doc.youtube ?? {};
  $('f-yt-title').value = yt.title ?? '';
  $('f-yt-description').value = yt.description ?? '';
  $('f-yt-tags').value = Array.isArray(yt.tags) ? yt.tags.join(', ') : '';
  $('f-yt-thumb').value = yt.thumbnail_text ?? '';

  // Un script fraichement ouvert repart de son texte enregistre.
  state.fullTextEdited = false;
  setEditorView('texte');

  renderBeats();
  renderAudioState();
  // La voix appartient au script : elle change avec lui.
  renderVoiceChoice();
};

/**
 * Intonation que l'usine retiendra pour chaque beat. Sert a afficher, sous
 * l'option « Automatique », ce qui sera reellement joue : rien ne part au
 * hasard, meme quand le script ne dit rien.
 */
const loadEmotions = async () => {
  if (!state.slug || state.mode !== 'edit') {
    state.emotions = null;
    return;
  }
  try {
    state.emotions = await api(`/api/emotions?slug=${encodeURIComponent(state.slug)}`);
  } catch {
    state.emotions = null;
  }
  if (state.mode === 'edit') renderBeats();
};

/** Copie dans le presse-papier, avec repli si le navigateur refuse. */
const copyText = async (text, label) => {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copié`);
  } catch {
    toast('Copie refusée par le navigateur : sélectionne le texte à la main', true);
  }
};

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', () => {
    const source = $(button.dataset.copy);
    copyText(source.textContent, source.closest('.pub-item')?.querySelector('span')?.textContent ?? 'Texte');
  });
}

/**
 * Tout ce qu'il faut pour publier le dernier rendu : titre, description avec
 * les credits obligatoires deja integres, tags. Chaque champ se copie d'un
 * clic — fini d'aller pecher les credits dans un fichier JSON.
 */
const loadPublish = async (slug) => {
  try {
    const meta = await api(`/api/meta?slug=${encodeURIComponent(slug)}`);
    $('pub-title').textContent = meta.title;
    $('pub-description').textContent = meta.description;
    $('pub-tags').textContent = (meta.tags ?? []).join(', ');
    $('pub-thumbprompt').textContent = meta.thumbnailPrompt ?? '';
    $('pub-thumb').textContent = meta.thumbnailText
      ? `Texte incrusté dans la miniature : « ${meta.thumbnailText} »`
      : '';
    $('publish').hidden = false;
  } catch {
    $('publish').hidden = true;
  }
};

/**
 * Un script deja rendu reaffiche sa video et son bloc Publier des qu'on
 * l'ouvre : le travail de la veille ne disparait plus au rechargement.
 */
const showExistingRender = () => {
  const file = currentScriptMeta()?.renders?.[0];
  if (file) {
    const url = `/media/${file}?t=${Date.now()}`;
    $('player').src = url;
    $('download').href = url;
    $('download').setAttribute('download', file);
    $('result').hidden = false;
    loadPublish(state.slug);
  } else {
    $('result').hidden = true;
    $('publish').hidden = true;
  }
};

const openScript = async (slug) => {
  if (
    state.dirty &&
    !confirmTwice(
      `open:${slug}`,
      'Modifications non enregistrées. Reclique pour changer de script sans les garder.',
    )
  ) {
    return;
  }
  state.slug = slug;
  state.doc = await api(`/api/scripts/${encodeURIComponent(slug)}`);
  if (!Array.isArray(state.doc.beats)) state.doc.beats = [];
  markDirty(false);
  renderEditor();
  renderScriptList();
  refreshQuota();
  loadEmotions();
  showExistingRender();
};

const collectDoc = () => ({
  ...state.doc,
  slug: state.slug,
  title: $('f-title').value.trim(),
  hook: $('f-hook').value.trim(),
  beats: state.doc.beats.map((b) => ({
    text: String(b.text ?? '').trim(),
    visual_query: String(b.visual_query ?? '').trim(),
    // Absente = intonation deduite du texte a la production.
    ...(b.emotion ? {emotion: b.emotion} : {}),
  })),
  youtube: {
    title: $('f-yt-title').value.trim(),
    description: $('f-yt-description').value,
    tags: $('f-yt-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    thumbnail_text: $('f-yt-thumb').value.trim(),
  },
});

const saveScript = async () => {
  if (!state.slug || state.mode !== 'edit') return;
  // Le texte modifie ne vit que dans la zone de saisie tant qu'il n'est pas
  // redecoupe : l'enregistrer maintenant le perdrait en silence.
  if (state.fullTextEdited) {
    return toast('Clique sur « Appliquer au découpage » avant d\'enregistrer', true);
  }
  try {
    const doc = collectDoc();
    await api(`/api/scripts/${encodeURIComponent(state.slug)}`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(doc),
    });
    state.doc = doc;
    markDirty(false);
    await loadScripts();
    // Le texte a change : le nombre de credits necessaires et les intonations
    // deduites aussi.
    refreshQuota();
    loadEmotions();
    toast('Script enregistré');
  } catch (err) {
    toast(err.message, true);
  }
};

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
const showPreview = (visible) => {
  $('i-head').hidden = !visible;
  $('i-cta').hidden = !visible;
};

const previewImport = debounce(async () => {
  const text = $('i-text').value;
  if (!text.trim()) {
    showPreview(false);
    $('i-preview').innerHTML = '';
    return;
  }
  try {
    const {beats, stats} = await api('/api/segment', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({text}),
    });
    showPreview(true);
    $('i-stats').textContent =
      `${beats.length} beats · ${stats.words} mots · environ ${stats.estimatedSeconds} s ` +
      `· ${stats.sentences} phrases sur ${stats.paragraphs} paragraphes`;
    $('i-preview').innerHTML = beats
      .map(
        (b, i) => `<li class="beat">
          <span class="beat-n">${i + 1}</span>
          <div>
            <div class="b-text">${escapeHtml(b.text)}</div>
            <div class="b-query">${escapeHtml(b.visual_query)}</div>
          </div>
        </li>`,
      )
      .join('');
  } catch (err) {
    showPreview(true);
    $('i-stats').textContent = err.message;
  }
}, 400);

$('import-script').addEventListener('click', () => {
  $('new-form').hidden = true;
  showMode('import');
  $('i-title').focus();
  renderCounters();
});

$('import-cancel').addEventListener('click', () => {
  showMode(state.doc ? 'edit' : 'empty');
  renderCounters();
});

$('i-text').addEventListener('input', previewImport);

const createFromImport = async () => {
  const title = $('i-title').value.trim();
  const text = $('i-text').value;
  if (!title) return toast('Donne un titre à la vidéo', true);
  if (!text.trim()) return toast('Colle le texte du script', true);

  try {
    const {slug, beats} = await api('/api/import', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({title, text, channel: state.activeChannel}),
    });
    $('i-title').value = '';
    $('i-text').value = '';
    $('i-preview').innerHTML = '';
    showPreview(false);
    await loadScripts();
    await openScript(slug);
    toast(`Script créé et découpé en ${beats} beats. Tu peux joindre ta voix et produire.`);
  } catch (err) {
    toast(err.message, true);
  }
};

$('import-create').addEventListener('click', createFromImport);
$('import-create-bottom').addEventListener('click', createFromImport);

// ---------------------------------------------------------------------------
// Voix off : trois modes (generee / ma voix / speech-to-speech)
// ---------------------------------------------------------------------------
const currentScriptMeta = () => state.scripts.find((s) => s.slug === state.slug);

/**
 * Vrai si la production va vraiment appeler la synthese : une voix off deja
 * generee est reutilisee telle quelle, sauf demande explicite de refaire.
 */
const willSynthesize = () =>
  !currentScriptMeta()?.hasAudio || $('o-force-voice').checked;

/**
 * Ce qui va etre produit, resume en une ligne au-dessus du bouton : format,
 * voix, musique, duree estimee et cout en credits. On sait ce qu'on paie
 * AVANT de cliquer, plus besoin de derouler les reglages pour verifier.
 */
const renderRecap = () => {
  const box = $('recap');
  const ready = state.mode === 'edit' && state.doc;
  box.hidden = !ready;
  if (!ready) return;

  const words = countWords();
  $('r-format').textContent = $('o-format').value === 'long' ? '16:9' : '9:16';
  $('r-duree').textContent = `≈ ${Math.round(words / 2.5)} s`;
  $('r-music').textContent = state.music
    ? `♪ ${state.music.replace(/\.(mp3|wav|m4a|aac)$/i, '').slice(0, 24)}`
    : 'Sans musique';

  const voiceLabel =
    state.voiceMode === 'mine'
      ? 'Ta voix'
      : state.voiceMode === 'sts'
        ? 'Ta voix, relookée'
        : state.ttsEngine === 'xtts'
          ? 'Voix locale HD'
          : (selectedVoice()?.name ?? 'Voix du projet').split(' - ')[0];
  $('r-voice').textContent = voiceLabel;

  const eleven = state.voiceMode === 'tts' && state.ttsEngine === 'elevenlabs';
  const cout = $('r-cout');
  if (!eleven) {
    cout.hidden = true;
  } else if (!willSynthesize()) {
    cout.hidden = false;
    cout.textContent = 'Voix en cache · 0 crédit';
  } else {
    cout.hidden = false;
    cout.textContent = state.quota?.needed ? `${fmt(state.quota.needed)} crédits` : 'Crédits : calcul…';
  }
};

const renderAudioState = () => {
  const custom = Boolean(currentScriptMeta()?.hasAudio);
  const whisper = state.status?.whisper;
  const eleven = state.status?.elevenLabs;

  for (const [stateId, dropId] of [['audio-state', 'drop-audio'], ['audio-state-sts', 'drop-audio-sts']]) {
    const el = $(stateId);
    if (el) el.classList.toggle('custom', custom);
    $(dropId).hidden = !custom;
  }

  if (custom) {
    $('audio-state').textContent = 'Ta voix est en place, elle est le son de la vidéo.';
    $('audio-state-sts').textContent = 'Ta voix est en place. ElevenLabs va la relooker à la production.';
  } else {
    $('audio-state').textContent = 'Dépose ton enregistrement, il devient le son de la vidéo.';
    $('audio-state-sts').textContent =
      'Dépose ta voix : ElevenLabs garde ton intonation et plaque une autre voix par-dessus.';
  }

  // Le calage des sous-titres : ElevenLabs si la clé existe, sinon Whisper local.
  $('align-note').textContent = eleven
    ? 'Sous-titres calés par ElevenLabs (aligne le texte exact du script).'
    : whisper
      ? 'Sous-titres calés en local par transcription. Aucune clé requise.'
      : 'Sous-titres calés en local (le modèle se télécharge au premier usage, une fois).';

  $('sts-note').textContent = eleven
    ? 'ElevenLabs prêt. Choisis la voix cible ci-dessus.'
    : 'Nécessite au moins une clé ElevenLabs dans le trousseau (bouton « Clés » en haut).';
};

const setVoiceMode = (mode) => {
  state.voiceMode = mode;
  for (const btn of $('voice-mode').querySelectorAll('.seg-btn')) {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  }
  $('pane-tts').hidden = mode !== 'tts';
  $('pane-mine').hidden = mode !== 'mine';
  $('pane-sts').hidden = mode !== 'sts';
  if (mode === 'sts') loadElevenVoices();
  renderCounters();
  refreshQuota();
};

for (const btn of $('voice-mode').querySelectorAll('.seg-btn')) {
  btn.addEventListener('click', () => setVoiceMode(btn.dataset.mode));
}

const setTtsEngine = (engine) => {
  state.ttsEngine = engine;
  for (const btn of $('tts-engine').querySelectorAll('.seg-btn')) {
    btn.classList.toggle('active', btn.dataset.engine === engine);
  }
  $('engine-xtts').hidden = engine !== 'xtts';
  $('engine-elevenlabs').hidden = engine !== 'elevenlabs';
  if (engine === 'elevenlabs') loadElevenVoices();
  renderCounters();
  refreshQuota();
};

for (const btn of $('tts-engine').querySelectorAll('.seg-btn')) {
  btn.addEventListener('click', () => setTtsEngine(btn.dataset.engine));
}

/** La voix retenue pour la vidéo ouverte, ou null : celle du projet. */
const selectedVoice = () =>
  state.voices.find((v) => v.id === (state.doc?.voice_id ?? '')) ?? null;

const traitsOf = (v) =>
  [v.gender === 'female' ? 'féminine' : v.gender === 'male' ? 'masculine' : null, v.age, v.accent, v.descriptive]
    .filter(Boolean)
    .join(', ');

const renderVoiceChoice = () => {
  const voice = selectedVoice();
  const id = state.doc?.voice_id;
  $('voice-current').textContent = voice
    ? voice.name
    : id
      ? id // choisie mais catalogue pas encore chargé
      : 'Voix par défaut du projet';
  $('voice-current').classList.toggle('set', Boolean(id));

  const note = $('voice-note');
  if (!voice) {
    note.hidden = true;
  } else {
    note.hidden = false;
    const traits = traitsOf(voice);
    const paye = voice.requiresPaid && !state.status?.elevenLabsPaid;
    note.textContent = paye
      ? `${voice.name} vient de la bibliothèque : aucun de tes comptes ne peut l'utiliser sans plan payant.`
      : `${voice.name}${traits ? ` — ${traits}` : ''}${voice.source === 'bibliothèque' ? ' · bibliothèque ElevenLabs' : ''}`;
  }
  renderCounters();
};

/**
 * Les voix disponibles. Par defaut la selection maison ; « tout » ouvre le
 * catalogue entier, plus de trois cents voix pour le francais seul.
 */
const loadElevenVoices = async (language, set) => {
  const lang = language ?? state.voiceLanguage;
  const jeu = set ?? state.voiceSet;
  if (!state.status?.elevenLabs) return;
  if (state.voicesLoaded === `${lang}:${jeu}`) return;

  $('voice-list').innerHTML = '<li class="v-empty">Chargement des voix…</li>';
  try {
    state.voices = await api(
      `/api/voices?language=${encodeURIComponent(lang)}&set=${encodeURIComponent(jeu)}`,
    );
    state.voicesLoaded = `${lang}:${jeu}`;
    state.voiceLanguage = lang;
    state.voiceSet = jeu;

    // Cible du speech-to-speech : même catalogue, en liste simple.
    $('o-sts-voice').innerHTML =
      '<option value="">Choisis une voix…</option>' +
      state.voices
        .map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}</option>`)
        .join('');

    renderVoiceList();
    renderVoiceChoice();
  } catch (err) {
    $('voice-list').innerHTML = `<li class="v-empty">${escapeHtml(err.message)}</li>`;
    toast(err.message, true);
  }
};

const filteredVoices = () => {
  const q = $('voice-search').value.trim().toLowerCase();
  const gender = $('voice-gender').value;
  return state.voices.filter((v) => {
    if (gender && v.gender !== gender) return false;
    if (!q) return true;
    return [v.name, v.accent, v.descriptive, v.useCase, v.age].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
};

const renderVoiceList = () => {
  const list = $('voice-list');
  // Les favorites d'abord : c'est l'organisation demandee, la plus simple qui
  // soit. Le tri est stable, le reste de l'ordre ne bouge pas.
  const voices = filteredVoices()
    .slice()
    .sort((a, b) => (state.favs.has(b.id) ? 1 : 0) - (state.favs.has(a.id) ? 1 : 0));
  const chosen = state.doc?.voice_id ?? '';

  $('voices-count').textContent = `${voices.length} voix`;

  if (voices.length === 0) {
    list.innerHTML = '<li class="v-empty">Aucune voix pour cette recherche.</li>';
    return;
  }

  list.innerHTML = voices
    .map(
      (v) => `<li class="${v.id === chosen ? 'chosen' : ''}">
        <button class="icon-btn tiny" data-play="${escapeHtml(v.id)}" title="Écouter l'extrait">▸</button>
        <span class="v-name">${escapeHtml(v.name)}
          <span class="v-meta">${escapeHtml(v.note ?? (traitsOf(v) || '—'))}</span>
        </span>
        <button class="fav${state.favs.has(v.id) ? ' on' : ''}" data-fav="${escapeHtml(v.id)}"
                title="${state.favs.has(v.id) ? 'Retirer des favorites' : 'Mettre en favorite'}">★</button>
        <button class="btn btn-ghost small" data-sample="${escapeHtml(v.id)}">Sur mon script</button>
        <button class="btn small" data-pick="${escapeHtml(v.id)}">${v.id === chosen ? 'Choisie' : 'Choisir'}</button>
      </li>`,
    )
    .join('');

  for (const button of list.querySelectorAll('[data-fav]')) {
    button.addEventListener('click', () => {
      const id = button.dataset.fav;
      if (state.favs.has(id)) state.favs.delete(id);
      else state.favs.add(id);
      localStorage.setItem('voiceFavs', JSON.stringify([...state.favs]));
      renderVoiceList();
    });
  }

  const audio = $('preview-audio');

  for (const button of list.querySelectorAll('[data-play]')) {
    button.addEventListener('click', () => {
      const voice = state.voices.find((v) => v.id === button.dataset.play);
      if (!voice?.preview) return toast("Pas d'extrait pour cette voix", true);
      if (audio.dataset.id === voice.id && !audio.paused) return audio.pause();
      audio.src = voice.preview;
      audio.dataset.id = voice.id;
      audio.volume = 0.9;
      audio.play().catch(() => toast('Écoute impossible', true));
    });
  }

  for (const button of list.querySelectorAll('[data-sample]')) {
    button.addEventListener('click', async () => {
      if (!state.slug || state.mode !== 'edit') return toast("Ouvre d'abord un script", true);
      if (state.dirty) return toast("Enregistre le script avant d'écouter", true);
      button.disabled = true;
      button.textContent = '…';
      try {
        const res = await fetch('/api/voice-sample', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({voiceId: button.dataset.sample, slug: state.slug}),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? `Erreur ${res.status}`);
        audio.src = URL.createObjectURL(await res.blob());
        audio.dataset.id = `sample:${button.dataset.sample}`;
        audio.volume = 0.95;
        audio.play().catch(() => {});
      } catch (err) {
        toast(err.message, true);
      } finally {
        button.disabled = false;
        button.textContent = 'Sur mon script';
      }
    });
  }

  for (const button of list.querySelectorAll('[data-pick]')) {
    button.addEventListener('click', () => {
      if (!state.doc) return toast("Ouvre d'abord un script", true);
      // La voix appartient a la video : elle est enregistree dans le script.
      state.doc.voice_id = button.dataset.pick;
      markDirty();
      renderVoiceList();
      renderVoiceChoice();
      $('voices-overlay').hidden = true;
      toast(`Voix « ${state.voices.find((v) => v.id === button.dataset.pick)?.name} » retenue. Enregistre le script.`);
    });
  }
};

$('voice-browse').addEventListener('click', async () => {
  if (!state.status?.elevenLabs) return toast('Ajoute une clé ElevenLabs', true);
  $('voices-overlay').hidden = false;
  await loadElevenVoices();
  renderVoiceList();
});

$('voices-close').addEventListener('click', () => ($('voices-overlay').hidden = true));
$('voices-overlay').addEventListener('click', (event) => {
  if (event.target === $('voices-overlay')) $('voices-overlay').hidden = true;
});

$('voice-search').addEventListener('input', debounce(renderVoiceList, 150));
$('voice-gender').addEventListener('change', renderVoiceList);
$('voice-language').addEventListener('change', async () => {
  await loadElevenVoices($('voice-language').value);
  renderVoiceList();
});

for (const btn of $('voice-set').querySelectorAll('.seg-btn')) {
  btn.addEventListener('click', async () => {
    for (const other of $('voice-set').querySelectorAll('.seg-btn')) {
      other.classList.toggle('active', other === btn);
    }
    const jeu = btn.dataset.set;
    // Sinon un filtre laissé sur le catalogue ampute la sélection au retour.
    $('voice-search').value = '';
    $('voice-gender').value = '';
    $('voice-help').textContent =
      jeu === 'selection'
        ? "Vingt voix retenues pour raconter l'amour : registre chaud ou posé, capables de tenir une confidence. Le bouton ▸ joue l'extrait officiel, gratuitement. « Sur mon script » la fait lire les deux premiers beats de la vidéo ouverte : une centaine de crédits."
        : "Le catalogue entier, plus de trois cents voix pour le français. Cherche par nom, accent ou style. Les voix de la sélection y sont marquées d'une étoile.";
    await loadElevenVoices(undefined, jeu);
    renderVoiceList();
  });
}

$('voice-preview').addEventListener('click', () => {
  const voice = selectedVoice();
  if (!voice?.preview) return toast('Choisis une voix pour l\'écouter', true);
  const audio = $('preview-audio');
  if (audio.dataset.id === voice.id && !audio.paused) return audio.pause();
  audio.src = voice.preview;
  audio.dataset.id = voice.id;
  audio.volume = 0.9;
  audio.play().catch(() => toast('Écoute impossible', true));
});

// Ecouter la voix cible du speech-to-speech avant de lancer : l'extrait
// officiel de la voix, gratuit.
$('sts-preview').addEventListener('click', () => {
  const voice = state.voices.find((v) => v.id === $('o-sts-voice').value);
  if (!voice?.preview) return toast('Choisis une voix cible à écouter', true);
  const audio = $('preview-audio');
  if (audio.dataset.id === voice.id && !audio.paused) {
    audio.pause();
    return;
  }
  audio.src = voice.preview;
  audio.dataset.id = voice.id;
  audio.volume = 0.9;
  audio.play().catch(() => toast('Écoute impossible', true));
});

const uploadVoice = async (file) => {
  if (state.mode === 'import') {
    return toast('Termine l\'import d\'abord : clique sur « Découper et créer ».', true);
  }
  if (!state.slug) return toast("Choisis d'abord un script à gauche", true);
  if (state.dirty) return toast("Enregistre le script avant d'envoyer la voix", true);
  const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
  try {
    const result = await api(`/api/audio/${encodeURIComponent(state.slug)}?ext=${encodeURIComponent(ext)}`, {
      method: 'POST',
      body: file,
    });
    await loadScripts();
    renderAudioState();
    renderCounters();
    toast(`Voix envoyée (${Math.round(result.bytes / 1024)} Ko)`);
  } catch (err) {
    toast(err.message, true);
  }
};

const dropVoice = async () => {
  if (!state.slug) return;
  await api(`/api/audio/${encodeURIComponent(state.slug)}`, {method: 'DELETE'});
  await loadScripts();
  renderAudioState();
  renderCounters();
  toast('Voix retirée');
};

for (const id of ['o-audio', 'o-audio-sts']) {
  $(id).addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) uploadVoice(file);
  });
}
$('drop-audio').addEventListener('click', dropVoice);
$('drop-audio-sts').addEventListener('click', dropVoice);

// Acceleration de la voix deposee : la jauge n'apparait que si on l'active.
$('o-speed-on').addEventListener('change', () => {
  $('speed-row').hidden = !$('o-speed-on').checked;
  renderCounters();
});

$('o-voice-speed').addEventListener('input', () => {
  $('speed-value').textContent = `×${(Number($('o-voice-speed').value) / 100).toFixed(2).replace('.', ',')}`;
});

// ---------------------------------------------------------------------------
// Chaines et historique
// ---------------------------------------------------------------------------
$('channel-select').addEventListener('change', async () => {
  try {
    await api('/api/channels/active', {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({id: $('channel-select').value}),
    });
    state.activeChannel = $('channel-select').value;
    // Le script ouvert appartient peut-etre a une autre chaine : on repart net.
    state.slug = null;
    state.doc = null;
    markDirty(false);
    showMode('empty');
    $('result').hidden = true;
    $('publish').hidden = true;
    renderScriptList();
    renderCounters();
    loadHistory();
  } catch (err) {
    toast(err.message, true);
  }
});

$('channel-new').addEventListener('click', () => {
  const form = $('channel-form');
  form.hidden = !form.hidden;
  if (!form.hidden) $('channel-name').focus();
});

$('channel-cancel').addEventListener('click', () => {
  $('channel-form').hidden = true;
  $('channel-name').value = '';
});

const createChannel = async () => {
  const name = $('channel-name').value.trim();
  if (!name) return toast('Donne un nom à la chaîne', true);
  try {
    await api('/api/channels', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({name}),
    });
    $('channel-name').value = '';
    $('channel-form').hidden = true;
    await loadStatus();
    renderScriptList();
    loadHistory();
    toast(`Chaîne « ${name} » créée et activée`);
  } catch (err) {
    toast(err.message, true);
  }
};

$('channel-create').addEventListener('click', createChannel);
$('channel-name').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') createChannel();
  if (event.key === 'Escape') $('channel-cancel').click();
});

// Onglets Scripts / Videos produites
for (const btn of $('lib-tab').querySelectorAll('.seg-btn')) {
  btn.addEventListener('click', () => {
    state.libTab = btn.dataset.tab;
    for (const other of $('lib-tab').querySelectorAll('.seg-btn')) {
      other.classList.toggle('active', other === btn);
    }
    $('script-list').hidden = state.libTab !== 'scripts';
    $('history-list').hidden = state.libTab !== 'history';
    if (state.libTab === 'history') loadHistory();
  });
}

const renderHistory = () => {
  const list = $('history-list');
  if (state.history.length === 0) {
    list.innerHTML =
      '<li class="hint" style="border:0;padding:0;margin:0">Aucune vidéo produite sur cette chaîne pour l\'instant.</li>';
    return;
  }
  list.innerHTML = state.history
    .map(
      (h, i) => `<li><button data-h="${i}">
        <span class="s-title">${escapeHtml(h.title)}</span>
        <span class="s-meta">${new Date(h.at).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})} · ${h.format === 'long' ? '16:9' : '9:16'}</span>
      </button></li>`,
    )
    .join('');

  for (const button of list.querySelectorAll('[data-h]')) {
    button.addEventListener('click', () => {
      const entry = state.history[Number(button.dataset.h)];
      // La video se recharge dans le lecteur, avec son bloc Publier.
      const url = `/media/${entry.output}?t=${Date.now()}`;
      $('player').src = url;
      $('download').href = url;
      $('download').setAttribute('download', entry.output);
      $('result').hidden = false;
      loadPublish(entry.slug);
      if (state.scripts.some((s) => s.slug === entry.slug)) openScript(entry.slug);
    });
  }
};

const loadHistory = async () => {
  try {
    state.history = await api(`/api/history?channel=${encodeURIComponent(state.activeChannel)}`);
  } catch {
    state.history = [];
  }
  renderHistory();
};

// ---------------------------------------------------------------------------
// Trousseau de cles ElevenLabs
// ---------------------------------------------------------------------------
/** Date de remise a zéro. Une date déjà passée n'apprend rien : on la tait. */
const resetLabel = (unix) =>
  unix && unix * 1000 > Date.now()
    ? new Date(unix * 1000).toLocaleDateString('fr-FR', {day: 'numeric', month: 'long'})
    : null;

const renderKeys = () => {
  const payload = state.keys;
  const list = $('key-list');
  const total = $('key-total');
  if (!payload) return;

  if (payload.keys.length === 0) {
    list.innerHTML =
      '<li class="k-empty">Aucune clé pour l\'instant. Colle ta première clé ci-dessous.</li>';
    total.textContent = '';
    return;
  }

  list.innerHTML = payload.keys
    .map((k) => {
      const known = typeof k.remaining === 'number' && k.limit > 0;
      const pct = known ? Math.round((k.remaining / k.limit) * 100) : 0;
      const reset = resetLabel(k.resetUnix);
      const meta = k.error
        ? escapeHtml(k.error)
        : known
          ? `${fmt(k.remaining)} crédits restants sur ${fmt(k.limit)}` +
            (reset ? ` · remise à zéro le ${reset}` : '')
          : 'quota inconnu — clique sur « Rafraîchir les quotas »';

      return `<li class="${k.error ? 'bad' : ''}">
        <div class="k-head">
          <span class="k-label">${escapeHtml(k.label)}</span>
          <code class="k-mask">${escapeHtml(k.masked)}</code>
          <button class="icon-btn tiny" data-del="${escapeHtml(k.id)}" title="Retirer cette clé">×</button>
        </div>
        <div class="k-bar${known && pct <= 15 ? ' low' : ''}"><i style="width:${known ? Math.max(pct, 2) : 0}%"></i></div>
        <span class="k-meta">${meta}</span>
      </li>`;
    })
    .join('');

  total.textContent = payload.checked
    ? `${fmt(payload.total)} crédits disponibles au total, soit environ ${fmt(Math.round(payload.total / 1100))} vidéos courtes.`
    : `${fmt(payload.total)} crédits au dernier relevé.`;

  for (const button of list.querySelectorAll('[data-del]')) {
    button.addEventListener('click', async () => {
      const id = button.dataset.del;
      if (!confirmTwice(`key:${id}`, 'Reclique pour retirer cette clé du trousseau')) return;
      try {
        await api(`/api/keys/${encodeURIComponent(id)}`, {method: 'DELETE'});
        await loadKeys({refresh: false});
        await loadStatus();
        refreshQuota();
        toast('Clé retirée');
      } catch (err) {
        toast(err.message, true);
      }
    });
  }
};

const loadKeys = async ({refresh = false} = {}) => {
  state.keys = await api(`/api/keys${refresh ? '?refresh=1' : ''}`);
  renderKeys();
};

const openKeys = async () => {
  $('keys-overlay').hidden = false;
  try {
    // Ouverture instantanee sur le dernier relevé, puis quotas rafraichis.
    await loadKeys({refresh: false});
    await loadKeys({refresh: true});
  } catch (err) {
    toast(err.message, true);
  }
};

$('keys-open').addEventListener('click', openKeys);
$('quota-keys').addEventListener('click', openKeys);
$('keys-close').addEventListener('click', () => ($('keys-overlay').hidden = true));
$('keys-overlay').addEventListener('click', (event) => {
  if (event.target === $('keys-overlay')) $('keys-overlay').hidden = true;
});

$('keys-refresh').addEventListener('click', async () => {
  const button = $('keys-refresh');
  button.disabled = true;
  button.textContent = 'Relevé…';
  try {
    await loadKeys({refresh: true});
    refreshQuota();
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Rafraîchir les quotas';
  }
});

const addKey = async () => {
  const key = $('key-value').value.trim();
  if (!key) return toast('Colle la clé ElevenLabs', true);
  const button = $('key-add');
  button.disabled = true;
  button.textContent = 'Vérification…';
  try {
    const added = await api('/api/keys', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({label: $('key-label').value.trim(), key}),
    });
    $('key-label').value = '';
    $('key-value').value = '';
    await loadKeys({refresh: true});
    await loadStatus();
    refreshQuota();
    toast(`Clé « ${added.label} » ajoutée : ${fmt(added.quota.remaining)} crédits disponibles`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Ajouter la clé';
  }
};

$('key-add').addEventListener('click', addKey);

// Les cles simples du .env : Pexels, reglable sans ouvrir de
// fichier. C'est ce qui manquait pour qu'une installation neuve soit
// utilisable sans passer par l'editeur de texte.
for (const button of document.querySelectorAll('[data-env]')) {
  button.addEventListener('click', async () => {
    const name = button.dataset.env;
    const input = $('env-pexels');
    button.disabled = true;
    button.textContent = '…';
    try {
      const r = await api('/api/env-keys', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({name, value: input.value.trim()}),
      });
      input.value = '';
      await loadStatus();
      toast(r.set ? `Clé ${r.service} enregistrée` : `Clé ${r.service} retirée`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Enregistrer';
    }
  });
}
$('key-value').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') addKey();
});

// ---------------------------------------------------------------------------
// Quota ElevenLabs pour le script ouvert
// ---------------------------------------------------------------------------
const renderQuotaLine = () => {
  const box = $('eleven-quota');
  const q = state.quota;
  if (!q) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.className = `quota ${q.ok ? 'ok' : 'bad'}`;
  box.textContent = q.ok
    ? `Quota suffisant : ${fmt(q.needed)} crédits pour cette vidéo, ${fmt(q.total)} disponibles ` +
      `sur ${q.keys.length} clé${q.keys.length > 1 ? 's' : ''}.`
    : `Quota insuffisant : ${fmt(q.needed)} crédits nécessaires, ${fmt(q.total)} disponibles. ` +
      'Ajoute une clé, raccourcis le script, ou passe la voix en local.';
};

/** Releve le quota reel des cles pour le script ouvert (ElevenLabs seulement). */
const refreshQuota = debounce(async () => {
  const relevant =
    state.mode === 'edit' &&
    state.slug &&
    state.voiceMode === 'tts' &&
    state.ttsEngine === 'elevenlabs' &&
    state.status?.elevenLabs;

  if (!relevant) {
    state.quota = null;
    renderQuotaLine();
    renderCounters();
    return;
  }

  try {
    state.quota = await api(`/api/quota?slug=${encodeURIComponent(state.slug)}`);
  } catch {
    // Quota inconnu : on ne bloque pas la production pour autant, build.mjs
    // refera la verification avant de consommer quoi que ce soit.
    state.quota = null;
  }
  renderQuotaLine();
  renderCounters();
}, 250);

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------
const appendLog = (text) => {
  const pre = $('console');
  const line = document.createElement('span');
  const t = text.trim();
  if (/^✓/.test(t)) line.className = 'ok';
  else if (/^!/.test(t)) line.className = 'warn';
  else if (/^✗/.test(t) || /\b(Error|Erreur|Echec|Échec)\b/i.test(t)) line.className = 'err';
  line.textContent = text + '\n';
  pre.append(line);
  pre.scrollTop = pre.scrollHeight;
};

/**
 * Une seule barre pour les deux phases : preparer puis rendre. La preparation
 * prend le premier tiers, le rendu le reste — c'est a peu pres leur poids reel.
 */
const setProgress = (phase, percent) => {
  const global = phase === 'build' ? percent * 0.35 : 35 + percent * 0.65;
  $('progress-fill').style.width = `${global}%`;
  $('progress-percent').textContent = `${Math.round(global)} %`;
  $('progress-step').textContent =
    phase === 'build' ? 'Préparation : voix, visuels, sous-titres' : 'Rendu image par image';
};

const startClock = () => {
  const started = Date.now();
  clearInterval(state.clock);
  const tick = () => {
    const s = Math.floor((Date.now() - started) / 1000);
    $('job-elapsed').textContent = `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  };
  tick();
  state.clock = setInterval(tick, 1000);
};

const stopClock = () => clearInterval(state.clock);

const setRunning = (running) => {
  state.running = running;
  $('stop').hidden = !running;
  $('stop').disabled = false;
  $('job-spinner').hidden = !running;
  for (const el of $('prod-form').querySelectorAll('input, select, button')) {
    if (el.id !== 'stop') el.disabled = running;
  }
  $('produce').disabled = running || scriptIssues().length > 0;
};

const produce = async () => {
  if (state.mode !== 'edit' || !state.slug) return toast('Choisis un script', true);
  if (state.dirty) return toast('Enregistre le script avant de produire', true);

  if (!state.status.pexels && !$('o-no-media').checked) {
    return toast('Clé PEXELS_API_KEY absente du .env', true);
  }
  const blockers = scriptIssues();
  if (blockers.length > 0) return toast(`À compléter : ${blockers.join(', ')}.`, true);

  const payload = {
    slug: state.slug,
    format: $('o-format').value,
    mediaType: $('o-media').value,
    music: state.music,
    musicVolume: Number($('o-volume').value) / 100,
    ttsEngine: state.voiceMode === 'tts' ? state.ttsEngine : null,
    ttsVoice:
      state.voiceMode === 'tts' && state.ttsEngine === 'xtts' ? $('o-xtts-voice').value : null,
    xttsClone: state.voiceMode === 'tts' && state.ttsEngine === 'xtts' && $('o-xtts-clone').checked,
    // La voix vit dans le script : le job ne fait que la relayer.
    voiceId:
      state.voiceMode === 'tts' && state.ttsEngine === 'elevenlabs'
        ? state.doc?.voice_id || null
        : null,
    stsVoice: state.voiceMode === 'sts' ? $('o-sts-voice').value || null : null,
    // Acceleration : uniquement en mode « Ma voix », quand la jauge est activee.
    voiceSpeed:
      state.voiceMode === 'mine' && $('o-speed-on').checked
        ? Number($('o-voice-speed').value) / 100
        : null,
    forceVoice: $('o-force-voice').checked,
    noMedia: $('o-no-media').checked,
    buildOnly: $('o-build-only').checked,
  };

  try {
    const {id} = await api('/api/jobs', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(payload),
    });
    state.jobId = id;
    $('console').textContent = '';
    $('job').hidden = false;
    $('result').hidden = true;
    $('publish').hidden = true;
    $('job-phase').textContent = 'Préparation';
    setProgress('build', 0);
    startClock();
    setRunning(true);
    listen(id);
  } catch (err) {
    toast(err.message, true);
  }
};

const listen = (id) => {
  state.source?.close();
  const source = new EventSource(`/api/jobs/${id}/stream`);
  state.source = source;

  source.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'log') appendLog(data.text);

    if (data.type === 'progress') setProgress(data.phase, data.percent);

    if (data.type === 'phase') {
      $('job-phase').textContent = data.phase === 'build' ? 'Préparation' : 'Rendu';
      setProgress(data.phase, 0);
    }

    if (data.type === 'end') {
      source.close();
      state.source = null;
      setRunning(false);
      stopClock();
      if (data.status === 'done') setProgress('render', 100);
      $('progress-step').textContent =
        data.status === 'done'
          ? 'Terminé'
          : data.status === 'stopped'
            ? 'Arrêté'
            : 'Échec, voir le détail technique';
      $('job-hint').hidden = data.status === 'done';
      $('job-phase').textContent =
        data.status === 'done' ? 'Terminé' : data.status === 'stopped' ? 'Arrêté' : 'Échec';

      if (data.status === 'done' && data.output) {
        const url = `/media/${data.output}?t=${Date.now()}`;
        $('player').src = url;
        $('download').href = url;
        $('download').setAttribute('download', data.output);
        $('result').hidden = false;
        loadPublish(state.slug);
        toast('Vidéo prête');
      } else if (data.status === 'done') {
        toast('Préparation terminée. Ouvre Remotion Studio pour vérifier.');
      } else if (data.status === 'error') {
        toast(`Échec pendant l'étape « ${data.step ?? 'production'} ». Voir la console.`, true);
      }
      loadScripts();
      loadStatus();
      // La production vient de consommer des credits : on remet le compteur a jour.
      refreshQuota();
    }
  };

  source.onerror = () => {
    if (state.source === source) {
      source.close();
      state.source = null;
      setRunning(false);
    }
  };
};

// ---------------------------------------------------------------------------
// Cablage
// ---------------------------------------------------------------------------
const createScript = async () => {
  const title = $('new-title').value.trim();
  if (!title) return toast('Donne un titre', true);
  const slug = slugify(title);
  if (!slug) return toast('Titre inutilisable comme nom de fichier', true);
  if (state.scripts.some((s) => s.slug === slug)) return toast('Ce script existe déjà', true);

  try {
    await api(`/api/scripts/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        slug,
        title,
        channel: state.activeChannel,
        hook: '',
        beats: [{text: '', visual_query: ''}],
        youtube: {title, description: '', tags: [], thumbnail_text: ''},
      }),
    });
    $('new-title').value = '';
    $('new-form').hidden = true;
    markDirty(false);
    await loadScripts();
    await openScript(slug);
  } catch (err) {
    toast(err.message, true);
  }
};

$('new-script').addEventListener('click', () => {
  const form = $('new-form');
  form.hidden = !form.hidden;
  if (!form.hidden) $('new-title').focus();
});

$('new-cancel').addEventListener('click', () => {
  $('new-form').hidden = true;
  $('new-title').value = '';
});

$('new-create').addEventListener('click', createScript);

$('new-title').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') createScript();
  if (event.key === 'Escape') $('new-cancel').click();
});

$('save-script').addEventListener('click', saveScript);

$('delete-script').addEventListener('click', async () => {
  if (!state.slug) return;
  if (!confirmTwice(`del:${state.slug}`, `Reclique pour envoyer « ${state.slug} » à la corbeille`)) {
    return;
  }
  const result = await api(`/api/scripts/${encodeURIComponent(state.slug)}`, {method: 'DELETE'});
  state.slug = null;
  state.doc = null;
  markDirty(false);
  showMode('empty');
  await loadScripts();
  renderCounters();
  toast(result.trashed ? `Déplacé vers ${result.trashed}` : 'Script supprimé');
});

$('fulltext-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('fulltext').value);
    toast('Texte copié');
  } catch {
    // Le presse-papier est refusé hors HTTPS sur certains navigateurs :
    // on sélectionne le texte, l'utilisateur fait Ctrl+C.
    $('fulltext').select();
    toast('Texte sélectionné : Ctrl+C pour copier');
  }
});

$('add-beat').addEventListener('click', () => {
  state.doc.beats.push({text: '', visual_query: ''});
  markDirty();
  renderBeats();
});

for (const id of ['f-title', 'f-hook', 'f-yt-title', 'f-yt-description', 'f-yt-tags', 'f-yt-thumb']) {
  $(id).addEventListener('input', () => {
    markDirty();
    if (id === 'f-title') renderCounters();
  });
}

// Re-synthetiser change la donne : la voix deja generee ne dispense plus du quota.
$('o-force-voice').addEventListener('change', () => {
  renderCounters();
  refreshQuota();
});

$('produce').addEventListener('click', produce);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('keys-overlay').hidden) $('keys-overlay').hidden = true;
});

$('stop').addEventListener('click', async () => {
  if (!state.jobId) return;
  $('stop').disabled = true;
  await api(`/api/jobs/${state.jobId}/stop`, {method: 'POST'});
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault();
    saveScript();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (state.dirty) event.preventDefault();
});

(async () => {
  try {
    await loadStatus();
    await loadScripts();
    renderCounters();
    loadHistory();
  } catch (err) {
    toast(err.message, true);
  }
})();

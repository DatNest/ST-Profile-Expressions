const EXT_ID = 'profile-expressions-test';
const STORAGE_KEY = 'profileExpressionsTest.settings.v1';

const DEFAULT_LABELS = [
  'anger','annoyance','amusement','caring','confusion','curiosity',
  'disappointment','disgust','desire','disapproval','embarrassment',
  'excitement','fear','grief','gratitude','joy','love','neutral',
  'optimism','pride','realization','relief','sadness','suspicious','surprise'
];

const DEFAULTS = {
  enabled: false,
  profileId: '',
  targetName: 'Clark',
  spriteFolder: 'Clark',
  maxChars: 5000,
  maxTokens: 48,
  labels: DEFAULT_LABELS.join(', '),
  prompt: `Determine the CURRENT VISIBLE facial/emotional expression of {{target}} in the latest roleplay message.

Choose exactly ONE label from this list:
{{labels}}

Rules:
- Judge only {{target}}.
- Prefer what is visibly expressed in the current moment, not a deep hidden feeling.
- If {{target}} does not appear or there is not enough evidence, output neutral.
- Do not invent new labels.
- Output ONLY the label, exactly as written in the list.`
};

let settings = loadSettings();
let busy = false;
let lastKey = '';

function loadSettings() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function ctx() {
  return window.SillyTavern?.getContext?.();
}

async function getCore() {
  const c = ctx();
  let eventSource = c?.eventSource;
  let eventTypes = c?.eventTypes;
  let service = c?.ConnectionManagerRequestService;

  if (!eventSource || !eventTypes) {
    const mod = await import('/script.js');
    eventSource ||= mod.eventSource;
    eventTypes ||= mod.event_types;
  }

  if (!service) {
    const shared = await import('/scripts/extensions/shared.js');
    service = shared.ConnectionManagerRequestService;
  }

  return { c, eventSource, eventTypes, service };
}

function status(text, kind = '') {
  const el = document.querySelector('#pet_status');
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
}

function parseLabels() {
  return settings.labels
    .split(/[\n,]+/)
    .map(x => x.trim())
    .filter(Boolean);
}

function extractText(result) {
  if (typeof result === 'string') return result;
  if (!result) return '';
  return (
    result.content ??
    result.text ??
    result.message?.content ??
    result.choices?.[0]?.message?.content ??
    result.choices?.[0]?.text ??
    ''
  );
}

function cleanLabel(raw, labels) {
  let s = String(raw || '').trim().toLowerCase();

  // tolerate tiny wrappers, but do not fuzzy-invent labels
  s = s.replace(/```[\s\S]*?```/g, m => m.replace(/```(?:json|text)?/gi, '').replace(/```/g, '').trim());
  s = s.replace(/^["'`\s]+|["'`.,;:!?\s]+$/g, '');

  const exact = labels.find(x => x.toLowerCase() === s);
  if (exact) return exact;

  // tolerate ANSWER: label or {"label":"label"}
  const answer = s.match(/(?:answer|label)\s*[:=]\s*["']?([a-z0-9_-]+)/i)?.[1];
  if (answer) {
    const hit = labels.find(x => x.toLowerCase() === answer.toLowerCase());
    if (hit) return hit;
  }

  return null;
}

function quoteSlash(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function classifyText(text, force = false) {
  if ((!settings.enabled && !force) || busy) return null;
  if (!settings.profileId) {
    status('Выбери Connection Profile.', 'bad');
    return null;
  }

  const labels = parseLabels();
  if (!labels.length) {
    status('Список эмоций пуст.', 'bad');
    return null;
  }

  const clipped = String(text || '').slice(-Math.max(500, Number(settings.maxChars) || 5000));
  if (!clipped.trim()) return null;

  const promptText = settings.prompt
    .replaceAll('{{target}}', settings.targetName || 'character')
    .replaceAll('{{labels}}', labels.join(', '));

  const messages = [
    { role: 'system', content: promptText },
    { role: 'user', content: clipped }
  ];

  busy = true;
  status('Классифицирую…');

  try {
    const { c, service } = await getCore();

    const profile = service.getProfile?.(settings.profileId);
    if (!profile || (service.isProfileSupported && !service.isProfileSupported(profile))) {
      throw new Error('Selected Connection Profile is unavailable or unsupported.');
    }

    const result = await service.sendRequest(
      settings.profileId,
      messages,
      Math.max(8, Number(settings.maxTokens) || 48),
      {
        stream: false,
        extractData: true,
        includePreset: true,
        includeInstruct: false
      },
      {
        temperature: 0.1,
        top_p: 0.9
      }
    );

    const raw = extractText(result);
    const label = cleanLabel(raw, labels);

    if (!label) {
      console.warn('[Profile Expressions Test] Unrecognized classifier reply:', raw);
      status(`Не распознано: ${String(raw).slice(0, 80)}`, 'bad');
      return null;
    }

    // Keep built-in Character Expressions enabled.
    // We only use its existing /costume and /expression-set commands.
    if (settings.spriteFolder?.trim()) {
      await c.executeSlashCommands(`/costume ${quoteSlash(settings.spriteFolder.trim())}`);
    }
    await c.executeSlashCommands(`/expression-set ${quoteSlash(label)}`);

    status(`✓ ${settings.targetName}: ${label}`, 'ok');
    console.debug('[Profile Expressions Test]', { label, raw });
    return label;
  } catch (err) {
    console.error('[Profile Expressions Test] Classification failed:', err, err?.cause);
    status(`Ошибка: ${err?.cause?.message || err?.message || err}`, 'bad');
    return null;
  } finally {
    busy = false;
  }
}

async function classifyLatest(force = false) {
  const c = ctx();
  if (!c?.chat?.length) {
    status('В чате нет сообщений.', 'bad');
    return;
  }

  let msg = null;
  let idx = -1;
  for (let i = c.chat.length - 1; i >= 0; i--) {
    const m = c.chat[i];
    if (!m?.is_user && !m?.is_system && String(m?.mes || '').trim()) {
      msg = m;
      idx = i;
      break;
    }
  }
  if (!msg) {
    status('Не найдено сообщение персонажа.', 'bad');
    return;
  }

  const key = `${idx}:${msg.mes}`;
  if (!force && key === lastKey) return;
  lastKey = key;

  await classifyText(msg.mes, force);
}

async function refreshProfiles() {
  const select = document.querySelector('#pet_profile');
  if (!select) return;

  const previous = settings.profileId;
  select.innerHTML = '<option value="">— выбери профиль —</option>';

  try {
    const { service } = await getCore();
    const profiles = service.getSupportedProfiles?.() || [];

    for (const p of profiles) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name || p.id}${p.model ? ` — ${p.model}` : ''}`;
      select.appendChild(opt);
    }

    if (profiles.some(p => p.id === previous)) {
      select.value = previous;
    } else if (previous) {
      settings.profileId = '';
      saveSettings();
    }

    status(`Профилей: ${profiles.length}`);
  } catch (err) {
    console.error('[Profile Expressions Test] Profiles failed:', err);
    status('Не удалось прочитать Connection Profiles.', 'bad');
  }
}

function buildUI() {
  if (document.querySelector('#pet_settings')) return;

  const host = document.querySelector('#extensions_settings');
  if (!host) {
    console.warn('[Profile Expressions Test] #extensions_settings not found.');
    return;
  }

  const block = document.createElement('div');
  block.id = 'pet_settings';
  block.className = 'extension_container';
  block.innerHTML = `
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>🎭 Profile Expressions — TEST</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>

      <div class="inline-drawer-content">
        <div class="pet-note">
          Тестовая надстройка над встроенным Character Expressions:
          классификация идёт через выбранный Connection Profile, а активный RP-профиль не переключается.
        </div>

        <label class="checkbox_label">
          <input id="pet_enabled" type="checkbox">
          <span>Автоклассификация включена</span>
        </label>

        <label for="pet_profile">Connection Profile классификатора</label>
        <div class="pet-row">
          <select id="pet_profile" class="text_pole"></select>
          <button id="pet_refresh_profiles" class="menu_button" title="Обновить список">↻</button>
        </div>

        <label for="pet_target">Кого классифицируем</label>
        <input id="pet_target" class="text_pole" type="text" placeholder="Clark">

        <label for="pet_folder">Папка спрайтов Character Expressions</label>
        <input id="pet_folder" class="text_pole" type="text" placeholder="Clark">
        <small>Перед установкой эмоции расширение вызывает /costume для этой папки.</small>

        <label for="pet_labels">Допустимые эмоции</label>
        <textarea id="pet_labels" class="text_pole textarea_compact" rows="4"></textarea>

        <label for="pet_prompt">Промпт классификатора</label>
        <textarea id="pet_prompt" class="text_pole textarea_compact" rows="9"></textarea>

        <div class="pet-two">
          <div>
            <label for="pet_maxchars">Макс. символов поста</label>
            <input id="pet_maxchars" class="text_pole" type="number" min="500" step="100">
          </div>
          <div>
            <label for="pet_maxtokens">Max output tokens</label>
            <input id="pet_maxtokens" class="text_pole" type="number" min="8" max="256">
          </div>
        </div>

        <div class="pet-row pet-actions">
          <button id="pet_test" class="menu_button">Тест на последнем посте</button>
          <button id="pet_reset" class="menu_button">Сбросить настройки</button>
        </div>

        <div id="pet_status" class="pet-status">Готово.</div>
      </div>
    </div>
  `;

  host.appendChild(block);

  const $ = (id) => document.querySelector(id);

  $('#pet_enabled').checked = !!settings.enabled;
  $('#pet_target').value = settings.targetName;
  $('#pet_folder').value = settings.spriteFolder;
  $('#pet_labels').value = settings.labels;
  $('#pet_prompt').value = settings.prompt;
  $('#pet_maxchars').value = settings.maxChars;
  $('#pet_maxtokens').value = settings.maxTokens;

  const bind = (sel, key, event = 'change', transform = v => v) => {
    $(sel).addEventListener(event, e => {
      settings[key] = transform(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      saveSettings();
    });
  };

  bind('#pet_enabled', 'enabled');
  bind('#pet_target', 'targetName', 'input');
  bind('#pet_folder', 'spriteFolder', 'input');
  bind('#pet_labels', 'labels', 'input');
  bind('#pet_prompt', 'prompt', 'input');
  bind('#pet_maxchars', 'maxChars', 'change', Number);
  bind('#pet_maxtokens', 'maxTokens', 'change', Number);

  $('#pet_profile').addEventListener('change', e => {
    settings.profileId = e.target.value;
    saveSettings();
  });

  $('#pet_refresh_profiles').addEventListener('click', refreshProfiles);
  $('#pet_test').addEventListener('click', () => classifyLatest(true));
  $('#pet_reset').addEventListener('click', () => {
    settings = { ...DEFAULTS };
    saveSettings();
    location.reload();
  });

  refreshProfiles();
}

async function initEvents() {
  const { eventSource, eventTypes } = await getCore();

  // Use the rendered character message event so the extension runs after the reply is visible.
  eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, async () => {
    // tiny delay lets the built-in Expressions extension finish its own local pass first
    await new Promise(r => setTimeout(r, 250));
    await classifyLatest(false);
  });

  if (eventTypes.CHAT_CHANGED) {
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
      lastKey = '';
      setTimeout(refreshProfiles, 100);
    });
  }
}

async function init() {
  buildUI();
  await initEvents();
  console.log('[Profile Expressions Test] loaded');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0), { once: true });
} else {
  setTimeout(init, 0);
}

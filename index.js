/**
 * Badges Bots — coller un badge (PNG) à côté du nom des personnages.
 * Tu uploades une image, puis tu choisis sur qui l’appliquer.
 */

const MODULE_NAME = 'badges_bots';
const LOG = '[Badges Bots]';
const MAX_SIDE = 96;

const defaultSettings = Object.freeze({
    enabled: true,
    badges: [],
});

const ctx = () => SillyTavern.getContext();
const save = () => ctx().saveSettingsDebounced();

let settings = null;
let paintTimer = 0;
let observer = null;

function loadSettings() {
    const store = ctx().extensionSettings;
    const prev = store[MODULE_NAME] || {};
    store[MODULE_NAME] = Object.assign({}, defaultSettings, prev);
    if (!Array.isArray(store[MODULE_NAME].badges)) {
        store[MODULE_NAME].badges = [];
    }
    settings = store[MODULE_NAME];
}

function characters() {
    return (ctx().characters || []).filter((item) => item && item.avatar);
}

function thumbnailFor(avatar) {
    try {
        if (avatar && avatar !== 'none' && typeof ctx().getThumbnailUrl === 'function') {
            return ctx().getThumbnailUrl('avatar', avatar);
        }
    } catch (err) {
        console.debug(LOG, 'miniature', err);
    }
    return 'img/ai4.png';
}

function newId() {
    return `bb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function fileToPngDataUrl(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            try {
                const scale = Math.min(1, MAX_SIDE / Math.max(img.width || 1, img.height || 1));
                const width = Math.max(1, Math.round((img.width || 1) * scale));
                const height = Math.max(1, Math.round((img.height || 1) * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const draw = canvas.getContext('2d');
                draw.clearRect(0, 0, width, height);
                draw.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/png'));
            } catch (err) {
                reject(err);
            } finally {
                URL.revokeObjectURL(url);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('image illisible'));
        };
        img.src = url;
    });
}

function badgesForAvatar(avatar) {
    if (!avatar || !settings || !settings.enabled) {
        return [];
    }
    return settings.badges.filter((badge) => Array.isArray(badge.avatars) && badge.avatars.includes(avatar));
}

function avatarFromImgSrc(src) {
    if (!src) {
        return '';
    }
    try {
        const url = new URL(src, window.location.href);
        const file = url.searchParams.get('file');
        if (file) {
            return decodeURIComponent(file);
        }
        const last = decodeURIComponent((url.pathname.split('/').pop() || '').split('?')[0]);
        return last && last !== 'ai4.png' ? last : '';
    } catch (err) {
        return '';
    }
}

function avatarFromMes(mes) {
    if (!mes || mes.getAttribute('is_user') === 'true') {
        return '';
    }
    const img = mes.querySelector('.mesAvatarWrapper .avatar img, .avatar img');
    const fromSrc = avatarFromImgSrc(img && img.getAttribute('src'));
    if (fromSrc) {
        const match = characters().find((item) => item.avatar === fromSrc);
        if (match) {
            return match.avatar;
        }
    }
    const name = mes.getAttribute('ch_name') || '';
    const byName = characters().find((item) => item.name === name);
    return byName ? byName.avatar : fromSrc;
}

function sameBadges(row, list) {
    if (!row) {
        return false;
    }
    const imgs = [...row.querySelectorAll('img.bb-badge')].map((img) => img.getAttribute('src'));
    if (imgs.length !== list.length) {
        return false;
    }
    return list.every((badge, i) => imgs[i] === badge.data);
}

function upsertBadges(afterEl, list) {
    if (!afterEl || !afterEl.parentElement) {
        return;
    }
    const parent = afterEl.parentElement;
    const existing = [...parent.children].find((el) => el.classList && el.classList.contains('bb-badges'));
    if (!list.length) {
        existing?.remove();
        return;
    }
    if (sameBadges(existing, list)) {
        return;
    }
    const row = document.createElement('span');
    row.className = 'bb-badges';
    for (const badge of list) {
        const img = document.createElement('img');
        img.className = 'bb-badge';
        img.src = badge.data;
        img.alt = '';
        img.draggable = false;
        row.appendChild(img);
    }
    if (existing) {
        existing.replaceWith(row);
    } else {
        afterEl.insertAdjacentElement('afterend', row);
    }
}

function paintChat() {
    document.querySelectorAll('#chat .mes').forEach((mes) => {
        const name = mes.querySelector('.name_text');
        if (!name) {
            return;
        }
        upsertBadges(name, badgesForAvatar(avatarFromMes(mes)));
    });
}

function paintList() {
    const list = characters();
    document.querySelectorAll('#rm_print_characters_block .character_select').forEach((el) => {
        const name = el.querySelector('.character_name_block > .ch_name');
        if (!name) {
            return;
        }
        const chid = el.getAttribute('chid');
        const byId = chid !== null && chid !== '' ? list[Number(chid)] : null;
        const fromImg = avatarFromImgSrc(el.querySelector('.avatar img')?.getAttribute('src'));
        const avatar = (byId && byId.avatar) || fromImg;
        upsertBadges(name, badgesForAvatar(avatar));
    });
}

function paintWelcome() {
    document.querySelectorAll('#chat .recentChat[data-avatar], .welcomePanel .recentChat[data-avatar]').forEach((el) => {
        const name = el.querySelector('.characterName');
        const avatar = el.getAttribute('data-avatar') || '';
        if (!name || !avatar) {
            return;
        }
        upsertBadges(name, badgesForAvatar(avatar));
    });
}

function clearPainted() {
    document.querySelectorAll('.bb-badges').forEach((el) => el.remove());
}

function paint() {
    if (!(settings && settings.enabled)) {
        clearPainted();
        return;
    }
    paintChat();
    paintList();
    paintWelcome();
}

function schedulePaint() {
    window.clearTimeout(paintTimer);
    paintTimer = window.setTimeout(paint, 40);
}

function bindObserver() {
    if (observer) {
        return;
    }
    observer = new MutationObserver(schedulePaint);
    const chat = document.getElementById('chat');
    const list = document.getElementById('rm_print_characters_block');
    const opts = { childList: true, subtree: true };
    if (chat) {
        observer.observe(chat, opts);
    }
    if (list) {
        observer.observe(list, opts);
    }
}

function characterPickerHtml(badge) {
    const list = characters();
    if (!list.length) {
        return '<div class="bb-empty">Aucun personnage pour l’instant.</div>';
    }
    const selected = new Set(badge.avatars || []);
    return `<div class="bb-char-list">${list.map((item) => {
        const checked = selected.has(item.avatar) ? ' checked' : '';
        const name = String(item.name || item.avatar || '').replace(/</g, '&lt;');
        const avatar = String(item.avatar).replace(/"/g, '&quot;');
        const thumb = thumbnailFor(item.avatar).replace(/"/g, '&quot;');
        return `<label class="bb-char">
            <input type="checkbox" data-avatar="${avatar}"${checked}>
            <img class="bb-char-avatar" src="${thumb}" alt="">
            <span class="bb-char-name">${name}</span>
        </label>`;
    }).join('')}</div>`;
}

function renderSettingsList() {
    const host = document.getElementById('bb_badge_list');
    if (!host || !settings) {
        return;
    }
    if (!settings.badges.length) {
        host.innerHTML = '<div class="bb-empty">Aucun badge pour l’instant. Ajoutes-en un ci-dessus, puis choisis les personnages.</div>';
        return;
    }
    host.innerHTML = settings.badges.map((badge) => {
        const title = String(badge.name || 'Badge').replace(/</g, '&lt;');
        return `<div class="bb-card" data-id="${badge.id}">
            <div class="bb-card-head">
                <img class="bb-card-preview" src="${badge.data}" alt="">
                <div class="bb-card-title">${title}</div>
                <button type="button" class="menu_button bb-card-remove" data-remove="${badge.id}">Supprimer</button>
            </div>
            <div class="bb-hint">Appliquer à</div>
            ${characterPickerHtml(badge)}
        </div>`;
    }).join('');

    host.querySelectorAll('input[type="checkbox"][data-avatar]').forEach((box) => {
        box.addEventListener('change', () => {
            const card = box.closest('.bb-card');
            const badge = settings.badges.find((item) => item.id === card?.dataset.id);
            if (!badge) {
                return;
            }
            const avatar = box.getAttribute('data-avatar');
            const next = new Set(badge.avatars || []);
            if (box.checked) {
                next.add(avatar);
            } else {
                next.delete(avatar);
            }
            badge.avatars = [...next];
            save();
            paint();
        });
    });

    host.querySelectorAll('[data-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-remove');
            settings.badges = settings.badges.filter((item) => item.id !== id);
            save();
            renderSettingsList();
            paint();
        });
    });
}

const SETTINGS_HTML = `
<div id="bb_settings" class="extension_container">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Badges Bots</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="bb-hint">Uploade une image (PNG de préférence), puis coche les personnages qui doivent avoir ce badge à côté de leur nom.</div>
      <div class="bb-row">
        <label for="bb_enabled">Activer</label>
        <input type="checkbox" id="bb_enabled">
      </div>
      <div class="bb-actions">
        <button type="button" class="menu_button" id="bb_add">Ajouter un badge</button>
        <input type="file" id="bb_file" accept="image/png,image/webp,image/gif,image/jpeg,image/*" hidden>
      </div>
      <div id="bb_badge_list"></div>
    </div>
  </div>
</div>`;

function bindSettingsUi() {
    const enabled = document.getElementById('bb_enabled');
    const add = document.getElementById('bb_add');
    const file = document.getElementById('bb_file');
    if (!enabled || !add || !file) {
        return;
    }
    enabled.checked = !!(settings && settings.enabled);
    enabled.addEventListener('input', () => {
        settings.enabled = enabled.checked;
        save();
        paint();
    });
    add.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
        const picked = file.files && file.files[0];
        file.value = '';
        if (!picked) {
            return;
        }
        try {
            const data = await fileToPngDataUrl(picked);
            settings.badges.push({
                id: newId(),
                name: picked.name || 'badge.png',
                data,
                avatars: [],
            });
            save();
            renderSettingsList();
            const cards = document.querySelectorAll('#bb_badge_list .bb-card');
            cards[cards.length - 1]?.scrollIntoView({ block: 'nearest' });
        } catch (err) {
            console.warn(LOG, 'import', err);
            window.toastr?.error?.('Impossible de lire cette image.') || alert('Impossible de lire cette image.');
        }
    });
    renderSettingsList();
}

jQuery(async () => {
    loadSettings();
    window.jQuery('#extensions_settings2').append(SETTINGS_HTML);
    bindSettingsUi();
    bindObserver();
    paint();

    try {
        const { eventSource, event_types } = ctx();
        const refresh = () => {
            loadSettings();
            renderSettingsList();
            paint();
        };
        eventSource.on(event_types.APP_READY, refresh);
        eventSource.on(event_types.CHAT_CHANGED, schedulePaint);
        eventSource.on(event_types.CHARACTER_PAGE_LOADED, refresh);
        eventSource.on(event_types.SETTINGS_LOADED_AFTER, refresh);
        if (event_types.CHARACTER_MESSAGE_RENDERED) {
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, schedulePaint);
        }
        if (event_types.USER_MESSAGE_RENDERED) {
            eventSource.on(event_types.USER_MESSAGE_RENDERED, schedulePaint);
        }
        if (event_types.MESSAGE_UPDATED) {
            eventSource.on(event_types.MESSAGE_UPDATED, schedulePaint);
        }
    } catch (err) {
        console.debug(LOG, 'évènements indisponibles', err);
    }
    console.log(LOG, 'chargé');
});

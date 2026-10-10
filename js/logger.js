// logger.js — журнал работы Словотрона.
//
// Записывает важные события: подключение и отключение чатов, медленные ответы
// и ошибки сервера слов, рост очереди слов, подвисания страницы, скрытие
// источника в OBS, раунды и победы. Раз в минуту добавляет сводку по словам.
// Последние записи хранятся в localStorage, поэтому журнал переживает
// перезапуск OBS. Загаданное слово в журнал не пишется.
//
// Как посмотреть журнал в OBS: правый клик по источнику → «Взаимодействовать»,
// кликнуть в окно и нажать L (в русской раскладке — Д). Повторное нажатие закрывает.
// Пока журнал открыт, его видно и на стриме.
(() => {
    const STORAGE_KEY = 'slovotron_log';
    const MAX_LINES = 1500;            // сколько последних записей хранить
    const SLOW_MS = 2000;              // ответ сервера слов дольше — предупреждение
    const STALL_MS = 5000;             // страница не выполняла код дольше — предупреждение
    const QUEUE_WARN = 10;             // очередь слов длиннее — предупреждение
    const SUMMARY_EVERY_MS = 60 * 1000;
    const SAVE_DELAY_MS = 1000;

    let lines = load();
    let saveTimer = null;
    let panel = null;
    let panelBody = null;
    let stats = newStats();
    let queueWarned = false;

    function newStats() {
        return { words: 0, totalMs: 0, maxMs: 0, errors: 0, maxQueue: 0 };
    }

    function load() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            return Array.isArray(saved) ? saved.slice(-MAX_LINES) : [];
        } catch {
            return [];
        }
    }

    function saveNow() {
        clearTimeout(saveTimer);
        saveTimer = null;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
        } catch { /* хранилище недоступно или переполнено — журнал живёт только в памяти */ }
    }

    function scheduleSave() {
        if (!saveTimer) saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
    }

    function stamp(d = new Date()) {
        const p = (n) => String(n).padStart(2, '0');
        return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }

    const sec = (ms) => `${(ms / 1000).toFixed(1)} с`;

    function plural(n, one, few, many) {
        const n10 = n % 10, n100 = n % 100;
        if (n10 === 1 && n100 !== 11) return one;
        if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
        return many;
    }

    function add(level, text) {
        const line = { t: stamp(), l: level, m: String(text) };
        lines.push(line);
        if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
        scheduleSave();

        const out = `[Лог] ${line.t} ${line.m}`;
        if (level === 'error') console.error(out);
        else if (level === 'warn') console.warn(out);
        else console.log(out);

        if (isPanelOpen()) appendLine(line);
    }

    function lineToText(line) {
        const tag = line.l === 'error' ? '[ОШИБКА] ' : line.l === 'warn' ? '[!] ' : '';
        return `${line.t}  ${tag}${line.m}`;
    }

    // --- Публичные функции для остального кода игры ------------------------------

    window.slv_log = (text) => add('info', text);
    window.slv_warn = (text) => add('warn', text);
    window.slv_error = (text) => add('error', text);

    // Вызывается после каждой проверки слова на сервере.
    window.slv_log_word = (word, ms, error) => {
        stats.words++;
        stats.totalMs += ms;
        stats.maxMs = Math.max(stats.maxMs, ms);

        if (error) {
            stats.errors++;
            add('error', `Ошибка проверки слова «${word}» через ${sec(ms)}: ${error?.message || error}`);
        } else if (ms >= SLOW_MS) {
            add('warn', `Медленный ответ сервера слов: ${sec(ms)} («${word}»)`);
        }
    };

    // Вызывается при каждом изменении длины очереди слов из чата Twitch.
    window.slv_log_queue = (length) => {
        stats.maxQueue = Math.max(stats.maxQueue, length);
        if (length >= QUEUE_WARN && !queueWarned) {
            queueWarned = true;
            add('warn', `Очередь слов выросла до ${length} — слова ждут ответа сервера`);
        } else if (length === 0 && queueWarned) {
            queueWarned = false;
            add('info', 'Очередь слов разобрана');
        }
    };

    window.slv_log_text = () => lines.map(lineToText).join('\n');

    // --- Сводка раз в минуту ---------------------------------------------------------

    setInterval(() => {
        if (!stats.words && !stats.errors) return;
        const avg = stats.words ? stats.totalMs / stats.words : 0;
        let text = `За минуту: ${stats.words} ${plural(stats.words, 'слово', 'слова', 'слов')}, `
            + `ответ в среднем ${sec(avg)}, максимум ${sec(stats.maxMs)}`;
        if (stats.maxQueue > 1) text += `, очередь до ${stats.maxQueue}`;
        if (stats.errors) text += `, ошибок: ${stats.errors}`;
        add(stats.errors ? 'warn' : 'info', text);
        stats = newStats();
    }, SUMMARY_EVERY_MS);

    // --- Подвисания и скрытие страницы ----------------------------------------------

    // Таймер тикает раз в секунду. Если между тиками прошло намного больше,
    // значит, страница не выполняла код: тяжёлая работа, нехватка ресурсов ПК
    // или OBS притормозил источник.
    let lastTick = Date.now();
    setInterval(() => {
        const now = Date.now();
        const gap = now - lastTick;
        lastTick = now;
        if (gap > STALL_MS && !document.hidden) {
            add('warn', `Страница не выполняла код ${sec(gap)} (подвисание)`);
        }
    }, 1000);

    document.addEventListener('visibilitychange', () => {
        lastTick = Date.now();
        add('info', document.hidden ? 'Страница скрыта (OBS не показывает источник)' : 'Страница снова видна');
    });

    // События, которые OBS присылает браузерным источникам.
    window.addEventListener('obsSourceActiveChanged', (e) => {
        add('info', e?.detail?.active ? 'Сцена с игрой вышла в эфир' : 'Сцена с игрой ушла из эфира');
    });
    window.addEventListener('obsSourceVisibleChanged', (e) => {
        add('info', e?.detail?.visible ? 'Источник с игрой показан' : 'Источник с игрой спрятан');
    });

    // Необработанные ошибки JavaScript.
    window.addEventListener('error', (e) => {
        if (!e?.message) return; // ошибки загрузки картинок и т.п.
        const file = String(e.filename || '').split('/').pop().split('?')[0];
        add('error', `Ошибка JS: ${e.message}${file ? ` (${file}:${e.lineno})` : ''}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
        add('error', `Необработанная ошибка: ${e?.reason?.message || e?.reason}`);
    });

    // Перед закрытием или обновлением страницы сохраняем журнал сразу.
    window.addEventListener('pagehide', saveNow);

    // --- Окно журнала -----------------------------------------------------------------

    const isPanelOpen = () => !!panel && panel.style.display !== 'none';

    function button(text, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.style.cssText = 'width:auto;flex:0 0 auto;background:#333;color:#eee;border:1px solid #555;'
            + 'border-radius:6px;padding:5px 12px;font:13px sans-serif;cursor:pointer;margin-left:8px;';
        b.addEventListener('click', onClick);
        return b;
    }

    function buildPanel() {
        panel = document.createElement('div');
        panel.id = 'slv-log-panel';
        panel.style.cssText = 'position:fixed;inset:20px;z-index:100000;display:none;flex-direction:column;'
            + 'background:rgba(12,12,12,0.96);border:1px solid #444;border-radius:10px;'
            + 'box-shadow:0 10px 40px rgba(0,0,0,0.6);color:#ddd;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid #333;'
            + 'font:14px sans-serif;';
        const title = document.createElement('div');
        title.style.cssText = 'flex:1 1 auto;min-width:0;';
        title.textContent = 'Журнал Словотрона · L — закрыть · виден на стриме, пока открыт';

        const copyBtn = button('Копировать', () => copyLog(copyBtn));
        const clearBtn = button('Очистить', () => {
            lines = [];
            saveNow();
            add('info', 'Журнал очищен');
            renderAll();
        });
        const closeBtn = button('Закрыть', () => togglePanel(false));
        header.append(title, copyBtn, clearBtn, closeBtn);

        panelBody = document.createElement('div');
        panelBody.style.cssText = 'flex-grow:1;overflow:auto;padding:10px 14px;white-space:pre-wrap;'
            + 'word-break:break-word;font:13px/1.45 Consolas,"Courier New",monospace;user-select:text;';

        panel.append(header, panelBody);
        document.body.appendChild(panel);
    }

    function appendLine(line) {
        const row = document.createElement('div');
        row.textContent = lineToText(line);
        if (line.l === 'error') row.style.color = '#ff6b6b';
        else if (line.l === 'warn') row.style.color = '#ffd166';
        panelBody.appendChild(row);
        while (panelBody.childElementCount > MAX_LINES) panelBody.removeChild(panelBody.firstElementChild);
        panelBody.scrollTop = panelBody.scrollHeight;
    }

    function renderAll() {
        panelBody.textContent = '';
        if (!lines.length) {
            panelBody.textContent = 'Журнал пуст';
            return;
        }
        lines.forEach(appendLine);
    }

    function togglePanel(show) {
        if (!panel) buildPanel();
        const open = typeof show === 'boolean' ? show : !isPanelOpen();
        panel.style.display = open ? 'flex' : 'none';
        if (open) renderAll();
    }

    function copyLog(btn) {
        const text = window.slv_log_text();
        const done = (ok) => {
            btn.textContent = ok ? 'Скопировано ✓' : 'Не удалось — выделите текст вручную';
            setTimeout(() => { btn.textContent = 'Копировать'; }, 2500);
        };
        const fallback = () => {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
                document.body.appendChild(ta);
                ta.select();
                const ok = document.execCommand('copy');
                ta.remove();
                done(ok);
            } catch {
                done(false);
            }
        };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(() => done(true), fallback);
        } else {
            fallback();
        }
    }

    window.slv_log_toggle = togglePanel;

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const isL = e.code === 'KeyL' || e.keyCode === 76 || ['l', 'L', 'д', 'Д'].includes(e.key);
        if (!isL) return;
        const tag = e.target?.tagName || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
        e.preventDefault();
        togglePanel();
    });

    // --- Старт ------------------------------------------------------------------------

    const inObs = new URLSearchParams(location.search).has('obs-overlay');
    add('info', `──────── Страница загружена${inObs ? ' (оверлей OBS)' : ' (браузер)'} ────────`);
})();

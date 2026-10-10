// streamerbot.js — сообщения в чаты стрима через Streamer.bot.
//
// Игра подключается к WebSocket-серверу Streamer.bot на этом ПК и запускает действие.
// Что и в какие чаты написать, решает само действие.
//
// Действие «Словотрон: победа» — после каждой победы. Аргументы:
//   %message%   готовый текст, например: 🏆 Слово «стол» угадано! Победитель: Vasya [VK] · 37 попыток · 02:15
//   %winner%    ник победителя без метки площадки
//   %word%      загаданное слово
//   %platform%  Twitch, VK, YT, Kick или «Подсказка»
//   %attempts%  сколько слов проверили за раунд
//   %duration%  длительность раунда, мм:сс
//
// Действие «Словотрон: топ» — по команде из TOP_COMMANDS (config.js). Аргументы:
//   %message%   весь топ-10 одной строкой, у первых трёх — медали (для Twitch, до 500 символов)
//   %part1%     места 1–5, %part2% — места 6–10 (каждая часть до 200 символов, для YouTube)
//
// Отправка идёт только из оверлея OBS (ссылка с obs-overlay), чтобы копия игры,
// открытая в обычном браузере, не дублировала сообщения в чатах.
(() => {
    const STREAMERBOT_URL = 'ws://127.0.0.1:8080/';
    const WIN_ACTION = 'Словотрон: победа';
    const TOP_ACTION = 'Словотрон: топ';
    const TOP_CHAT_SIZE = 10;            // сколько мест отправлять в чат (на экране — LEADERBOARD_SIZE)
    const TOP_MEDALS = ['🥇', '🥈', '🥉'];
    const TOP_COOLDOWN_MS = 30 * 1000;   // как часто топ может уходить в чат
    const MAX_NAME_LENGTH = 40;           // ник в сообщении о победе
    const MAX_TOP_NAME_LENGTH = 20;       // ник в списке топа
    const TWITCH_LIMIT = 500;
    const YOUTUBE_LIMIT = 200;
    const SEND_TIMEOUT_MS = 5000;

    const PLATFORM_TAGS = {
        VKVideoLive: 'VK',
        VKPlay: 'VK',
        YouTube: 'YT',
        Kick: 'Kick',
    };

    let lastTopSentAt = 0;

    const isOverlay = () => document.body.classList.contains('obs-overlay');

    function formatDuration(sec) {
        const s = Math.max(0, Math.floor(sec || 0));
        return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    function cut(text, max = MAX_NAME_LENGTH) {
        const t = String(text || '').replace(/\s+/g, ' ').trim();
        return t.length > max ? t.slice(0, max - 1) + '…' : t;
    }

    function plural(n, one, few, many) {
        const n10 = n % 10, n100 = n % 100;
        if (n10 === 1 && n100 !== 11) return one;
        if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
        return many;
    }

    // Открывает соединение, запускает действие и закрывает соединение после ответа.
    function runAction(actionName, args) {
        let ws;
        try {
            ws = new WebSocket(STREAMERBOT_URL);
        } catch (e) {
            console.warn('[Streamer.bot] не удалось подключиться:', e);
            return;
        }

        const requestId = `slovotron-${Date.now()}`;
        const timer = setTimeout(() => {
            console.warn('[Streamer.bot] нет ответа — включён ли WebSocket-сервер на 127.0.0.1:8080?');
            try { ws.close(); } catch { /* уже закрыто */ }
        }, SEND_TIMEOUT_MS);

        ws.onopen = () => {
            ws.send(JSON.stringify({
                request: 'DoAction',
                id: requestId,
                action: { name: actionName },
                args,
            }));
        };

        ws.onmessage = (e) => {
            let msg;
            try { msg = JSON.parse(e.data); } catch { return; }
            if (msg.id !== requestId) return; // приветствие сервера и прочие сообщения

            clearTimeout(timer);
            if (msg.status === 'ok') {
                console.log(`[Streamer.bot] «${actionName}» отправлено в чаты`);
                window.slv_log?.(`Streamer.bot: «${actionName}» отправлено в чаты`);
            } else {
                console.warn(`[Streamer.bot] ошибка в «${actionName}»:`, msg.error || msg);
                window.slv_warn?.(`Streamer.bot: ошибка в «${actionName}»: ${msg.error || 'см. Streamer.bot'}`);
            }
            ws.close();
        };

        ws.onerror = () => {
            clearTimeout(timer);
            console.warn('[Streamer.bot] WebSocket-сервер недоступен (ws://127.0.0.1:8080/)');
            window.slv_warn?.(`Streamer.bot недоступен — «${actionName}» не отправлено`);
        };
    }

    // --- Победа -----------------------------------------------------------------

    function describeWinner(user) {
        const login = String(user?.username || '');
        const shown = String(user?.['display-name'] || login);

        if (login === 'podskazka') {
            return { platform: 'Подсказка', name: '', shown: '' };
        }
        // Игроки из MiniChat приходят как "VKVideoLive:login" и с меткой " [VK]" в нике.
        const sep = login.indexOf(':');
        if (sep > 0) {
            const service = login.slice(0, sep);
            return {
                platform: PLATFORM_TAGS[service] || service,
                name: cut(shown.replace(/\s\[[^\]]+\]$/, '')),
                shown: cut(shown),
            };
        }
        return { platform: 'Twitch', name: cut(shown), shown: cut(shown) };
    }

    function buildWinMessage(winner, word, attempts, duration) {
        const stats = `${attempts} ${plural(attempts, 'попытка', 'попытки', 'попыток')} · ${duration}`;
        if (winner.platform === 'Подсказка') {
            return `💡 Никто не угадал, слово открыла подсказка: «${word}» · ${stats}`;
        }
        return `🏆 Слово «${word}» угадано! Победитель: ${winner.shown} · ${stats}`;
    }

    window.notify_streamerbot_win = function (winnerUser, word, stats = {}) {
        if (!isOverlay() || !word) return;
        if (winnerUser?.username === 'TestUser') return; // тестовая победа из меню

        const winner = describeWinner(winnerUser);
        const attempts = Number(stats.attempts) || 0;
        const duration = formatDuration(stats.durationSec);

        runAction(WIN_ACTION, {
            message: buildWinMessage(winner, word, attempts, duration),
            winner: winner.name,
            word: String(word),
            platform: winner.platform,
            attempts,
            duration,
        });
    };

    // --- Топ-10 -----------------------------------------------------------------

    function getTopEntries() {
        if (typeof getLeaderboardData !== 'function') return [];
        return Object.entries(getLeaderboardData())
            .sort((a, b) => b[1] - a[1])
            .slice(0, TOP_CHAT_SIZE)
            .map(([name, wins], i) => `${TOP_MEDALS[i] || `${i + 1}.`} ${cut(name, MAX_TOP_NAME_LENGTH)} (${wins})`);
    }

    function fit(text, limit) {
        return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
    }

    function buildTopMessages() {
        const entries = getTopEntries();
        if (!entries.length) {
            const empty = '🏆 В Словотроне пока нет победителей';
            return { message: empty, part1: empty, part2: '' };
        }

        const n = entries.length;
        const first = entries.slice(0, 5);
        const rest = entries.slice(5);

        return {
            message: fit(`🏆 Топ-${n} Словотрона: ${entries.join(' · ')}`, TWITCH_LIMIT),
            part1: fit(`🏆 Топ-${n} Словотрона: ${first.join(' · ')}`, YOUTUBE_LIMIT),
            part2: rest.length ? fit(rest.join(' · '), YOUTUBE_LIMIT) : '',
        };
    }

    window.notify_streamerbot_top = function () {
        if (!isOverlay()) return;

        const now = Date.now();
        if (now - lastTopSentAt < TOP_COOLDOWN_MS) {
            console.log('[Streamer.bot] топ недавно уже отправлялся, жду кулдаун');
            return;
        }
        lastTopSentAt = now;

        runAction(TOP_ACTION, buildTopMessages());
    };
})();

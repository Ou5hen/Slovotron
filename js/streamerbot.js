// streamerbot.js — сообщение о победе в чаты стрима через Streamer.bot.
//
// После каждой победы игра подключается к WebSocket-серверу Streamer.bot на этом ПК
// и запускает действие STREAMERBOT_ACTION. Что и в какие чаты написать, решает
// само действие. В него передаются аргументы:
//   %message%   готовый текст, например: 🏆 Слово «стол» угадано! Победитель: Vasya [VK] · 37 попыток · 02:15
//   %winner%    ник победителя без метки площадки
//   %word%      загаданное слово
//   %platform%  Twitch, VK, YT, Kick или «Подсказка»
//   %attempts%  сколько слов проверили за раунд
//   %duration%  длительность раунда, мм:сс
//
// Отправка идёт только из оверлея OBS (ссылка с obs-overlay), чтобы копия игры,
// открытая в обычном браузере, не дублировала сообщения в чатах.
(() => {
    const STREAMERBOT_URL = 'ws://127.0.0.1:8080/';
    const STREAMERBOT_ACTION = 'Словотрон: победа';
    const MAX_NAME_LENGTH = 40;
    const SEND_TIMEOUT_MS = 5000;

    const PLATFORM_TAGS = {
        VKVideoLive: 'VK',
        VKPlay: 'VK',
        YouTube: 'YT',
        Kick: 'Kick',
    };

    const isOverlay = () => document.body.classList.contains('obs-overlay');

    function formatDuration(sec) {
        const s = Math.max(0, Math.floor(sec || 0));
        return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    function cut(text) {
        const t = String(text || '').replace(/\s+/g, ' ').trim();
        return t.length > MAX_NAME_LENGTH ? t.slice(0, MAX_NAME_LENGTH - 1) + '…' : t;
    }

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

    function buildMessage(winner, word, attempts, duration) {
        const stats = `${attempts} ${plural(attempts, 'попытка', 'попытки', 'попыток')} · ${duration}`;
        if (winner.platform === 'Подсказка') {
            return `💡 Никто не угадал, слово открыла подсказка: «${word}» · ${stats}`;
        }
        return `🏆 Слово «${word}» угадано! Победитель: ${winner.shown} · ${stats}`;
    }

    function plural(n, one, few, many) {
        const n10 = n % 10, n100 = n % 100;
        if (n10 === 1 && n100 !== 11) return one;
        if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
        return many;
    }

    // Открывает соединение, отправляет DoAction и закрывает соединение после ответа.
    function runAction(args) {
        let ws;
        try {
            ws = new WebSocket(STREAMERBOT_URL);
        } catch (e) {
            console.warn('[Streamer.bot] не удалось подключиться:', e);
            return;
        }

        const requestId = `slovotron-win-${Date.now()}`;
        const timer = setTimeout(() => {
            console.warn('[Streamer.bot] нет ответа — включён ли WebSocket-сервер на 127.0.0.1:8080?');
            try { ws.close(); } catch { /* уже закрыто */ }
        }, SEND_TIMEOUT_MS);

        ws.onopen = () => {
            ws.send(JSON.stringify({
                request: 'DoAction',
                id: requestId,
                action: { name: STREAMERBOT_ACTION },
                args,
            }));
        };

        ws.onmessage = (e) => {
            let msg;
            try { msg = JSON.parse(e.data); } catch { return; }
            if (msg.id !== requestId) return; // приветствие сервера и прочие сообщения

            clearTimeout(timer);
            if (msg.status === 'ok') {
                console.log('[Streamer.bot] победа отправлена в чаты');
            } else {
                console.warn('[Streamer.bot] ошибка:', msg.error || msg);
            }
            ws.close();
        };

        ws.onerror = () => {
            clearTimeout(timer);
            console.warn('[Streamer.bot] WebSocket-сервер недоступен (ws://127.0.0.1:8080/)');
        };
    }

    window.notify_streamerbot_win = function (winnerUser, word, stats = {}) {
        if (!isOverlay() || !word) return;
        if (winnerUser?.username === 'TestUser') return; // тестовая победа из меню

        const winner = describeWinner(winnerUser);
        const attempts = Number(stats.attempts) || 0;
        const duration = formatDuration(stats.durationSec);

        runAction({
            message: buildMessage(winner, word, attempts, duration),
            winner: winner.name,
            word: String(word),
            platform: winner.platform,
            attempts,
            duration,
        });
    };
})();

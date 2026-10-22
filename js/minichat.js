// minichat.js — приём слов и !подсказка из MiniChat (VK Play, Kick, YouTube и др.) для Словотрона.
// Twitch по-прежнему читает сама игра, поэтому его сообщения здесь пропускаются.
(() => {
    const MINICHAT_URL = 'ws://localhost:4848/Chat';
    const SKIP_SERVICES = ['Twitch', 'MiniChat', 'StreamerBot'];
    const SHOW_PLATFORM_TAG = true; // показывать [VK], [Kick] и т.д. рядом с ником
    const TIP_COMMANDS = ['!подсказка']; // команды голосования за подсказку

    const PLATFORMS = {
        VKVideoLive: { tag: 'VK', color: '#0077FF' },
        VKPlay: { tag: 'VK', color: '#0077FF' },
        Kick: { tag: 'Kick', color: '#53FC18' },
        YouTube: { tag: 'YT', color: '#FF0000' },
    };

    // Собирает текст сообщения из частей MessageKit (смайлики и ссылки пропускаются)
    function getText(data) {
        if (Array.isArray(data.MessageKit) && data.MessageKit.length) {
            return data.MessageKit
                .filter(p => p && p.Data && typeof p.Data.Text === 'string' && !p.Data.URL)
                .map(p => p.Data.Text)
                .join(' ');
        }
        return typeof data.Message === 'string' ? data.Message : '';
    }

    // Мост Kick -> MiniChat (kick_minichat_bridge.py): с 13.10.2026 MiniChat 0.15 сам не читает Kick,
    // и сообщения Kick приходят от имени MiniChat с меткой-смайликом "[Kick]..." в начале.
    // Возвращаем им сервис Kick и убираем метку. Если MiniChat снова сам читает Kick, это не срабатывает.
    function unwrapKickBridge(d) {
        const kit = d.MessageKit;
        if (d.Service !== 'MiniChat' || !Array.isArray(kit) || !kit.length) return;
        const first = kit[0];
        if (!first || first.Type !== 'Emoticon' || !first.Data ||
            typeof first.Data.Text !== 'string' || !first.Data.Text.startsWith('[Kick]')) return;
        d.Service = 'Kick';
        d.MessageKit = kit.slice(1);
    }

    function isTipCommand(text) {
        const lower = text.toLowerCase();
        return TIP_COMMANDS.some(c => lower === c || lower.startsWith(c + ' '));
    }

    function handleEvent(ev) {
        if (!ev || ev.Type !== 'Message' || !ev.Data) return;

        const d = ev.Data;
        unwrapKickBridge(d);
        const service = String(d.Service || '');
        if (!service || SKIP_SERVICES.includes(service)) return;

        const raw = getText(d).trim();
        if (!raw) return;

        const platform = PLATFORMS[service] || { tag: service, color: '#AAAAAA' };
        const name = d.UserName || d.Login || 'Аноним';
        const user = {
            username: `${service}:${String(d.Login || name).toLowerCase()}`,
            'display-name': SHOW_PLATFORM_TAG ? `${name} [${platform.tag}]` : name,
        };

        // голос за подсказку — тот же механизм, что и у Twitch
        if (isTipCommand(raw)) {
            if (typeof use_tip === 'function') use_tip(user.username);
            return;
        }

        // топ-10 победителей: здесь только показ на экране, в чат отвечает Streamer.bot
        if (typeof TOP_COMMANDS !== 'undefined' && TOP_COMMANDS.includes(raw.toLowerCase())) {
            if (typeof showLeaderboardTemporarily === 'function') showLeaderboardTemporarily();
            return;
        }

        if (raw.startsWith('!')) return; // остальные команды не считаем словами

        // убираем знаки препинания по краям, принимаем только одно слово из букв
        const word = raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
        if (!/^[\p{L}-]{2,30}$/u.test(word)) return;

        if (typeof process_message === 'function') {
            process_message(user, platform.color, word);
        }
    }

    let connected = false;
    let reportedDown = false;

    function connect() {
        const ws = new WebSocket(MINICHAT_URL);
        ws.onopen = () => {
            console.log('[MiniChat] подключено');
            connected = true;
            reportedDown = false;
            window.slv_log?.('MiniChat подключён');
        };
        ws.onclose = () => {
            if (connected) {
                window.slv_warn?.('MiniChat отключился, переподключаюсь каждые 5 с');
            } else if (!reportedDown) {
                window.slv_warn?.('MiniChat недоступен (localhost:4848) — чаты VK/YouTube/Kick не читаются');
            }
            connected = false;
            reportedDown = true;
            setTimeout(connect, 5000);
        };
        ws.onerror = () => ws.close();
        ws.onmessage = (e) => {
            let ev;
            try { ev = JSON.parse(e.data); } catch { return; }
            handleEvent(ev);
        };
    }

    connect();
})();

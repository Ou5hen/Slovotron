// minichat.js — приём слов из MiniChat (VK Play, Kick, YouTube и др.) для Словотрона.
// Twitch по-прежнему читает сама игра, поэтому его сообщения здесь пропускаются.
(() => {
    const MINICHAT_URL = 'ws://localhost:4848/Chat';
    const SKIP_SERVICES = ['Twitch', 'MiniChat', 'StreamerBot'];
    const SHOW_PLATFORM_TAG = true; // показывать [VK], [Kick] и т.д. рядом с ником

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

    function handleEvent(ev) {
        if (!ev || ev.Type !== 'Message' || !ev.Data) return;

        const d = ev.Data;
        const service = String(d.Service || '');
        if (!service || SKIP_SERVICES.includes(service)) return;

        const raw = getText(d).trim();
        if (!raw || raw.startsWith('!')) return; // команды не считаем словами

        // убираем знаки препинания по краям, принимаем только одно слово из букв
        const word = raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
        if (!/^[\p{L}-]{2,30}$/u.test(word)) return;

        const platform = PLATFORMS[service] || { tag: service, color: '#AAAAAA' };
        const name = d.UserName || d.Login || 'Аноним';
        const user = {
            username: `${service}:${String(d.Login || name).toLowerCase()}`,
            'display-name': SHOW_PLATFORM_TAG ? `${name} [${platform.tag}]` : name,
        };

        if (typeof process_message === 'function') {
            process_message(user, platform.color, word);
        }
    }

    function connect() {
        const ws = new WebSocket(MINICHAT_URL);
        ws.onopen = () => console.log('[MiniChat] подключено');
        ws.onclose = () => setTimeout(connect, 5000);
        ws.onerror = () => ws.close();
        ws.onmessage = (e) => {
            let ev;
            try { ev = JSON.parse(e.data); } catch { return; }
            handleEvent(ev);
        };
    }

    connect();
})();

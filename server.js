const express = require('express');
const crypto = require('crypto');
const app = express();

const PORT = process.env.PORT || 3000;
const SECRET_SALT = "GRANDPA_SUPER_SECRET_2026_KEY";
const LOOTLABS_API_TOKEN = "41226ca865083af846a334acd8959f8e5f63dd1aa98e8f5713764fd4605b2e1e";

const pendingSessions = new Map(); // token -> { hwid, createdAt }
const activeKeys = new Map();      // key -> { hwid, expiresAt }

function generateKeyForHwid(hwid) {
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    const hash = crypto.createHmac('sha256', SECRET_SALT)
        .update(hwid + randomPart)
        .digest('hex')
        .substring(0, 8)
        .toUpperCase();
    
    const key = `GP-${randomPart}-${hash}`;
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 часа
    activeKeys.set(key, { hwid, expiresAt });
    return { key, expiresAt };
}

// Очистка старых сессий каждые 10 минут
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of activeKeys.entries()) {
        if (now > v.expiresAt) activeKeys.delete(k);
    }
    for (const [t, v] of pendingSessions.entries()) {
        if (now - v.createdAt > 30 * 60 * 1000) pendingSessions.delete(t);
    }
}, 10 * 60 * 1000);

// 1. Старт генерации ключа
app.get('/start', (req, res) => {
    const hwid = req.query.hwid || 'UNKNOWN_HWID';
    const sessionToken = crypto.randomBytes(16).toString('hex');

    pendingSessions.set(sessionToken, {
        hwid: hwid,
        createdAt: Date.now()
    });

    res.send(renderHTML({
        title: "GRANDPA_POLUTION • Получение ключа",
        stepText: "Чекпоинт 1 из 1",
        hwid: hwid,
        buttonUrl: `/go-lootlabs?token=${sessionToken}`,
        keyData: null
    }));
});

// 2. Генерация ссылки через официальный LootLabs API
app.get('/go-lootlabs', async (req, res) => {
    const token = req.query.token;
    const session = pendingSessions.get(token);

    if (!session) {
        return res.status(403).send("Сессия устарела или недействительна. Вернитесь в игру и скопируйте ссылку заново.");
    }

    session.createdAt = Date.now();
    const callbackUrl = `${req.protocol}://${req.get('host')}/verify?token=${token}`;

    try {
        const apiEndpoint = 'https://creators.lootlabs.gg/api/public/content_locker';
        
        const requestData = {
            title: "GRANDPA_POLUTION Key",
            url: callbackUrl,
            tier_id: 2,
            number_of_tasks: 2,
            theme: 1
        };

        const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${LOOTLABS_API_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        const data = await response.json();
        console.log("Ответ от LootLabs:", data);

        let lootUrl = null;
        if (data && data.message) {
            if (typeof data.message === 'string') {
                console.error("LootLabs API Error:", data.message);
                return res.status(500).send("Ошибка LootLabs API: " + data.message);
            } else if (Array.isArray(data.message) && data.message[0] && data.message[0].loot_url) {
                lootUrl = data.message[0].loot_url;
            } else if (data.message.loot_url) {
                lootUrl = data.message.loot_url;
            }
        }

        if (lootUrl) {
            return res.redirect(lootUrl);
        } else {
            console.error("Не удалось найти loot_url в ответе:", data);
            return res.status(500).send("Ошибка: LootLabs не вернул ссылку на рекламу.");
        }
    } catch (err) {
        console.error("Fetch error:", err);
        return res.status(500).send("Сбой соединения с сервером рекламной сети LootLabs.");
    }
});

// 3. Верификация и выдача ключа
app.get('/verify', (req, res) => {
    const token = req.query.token;
    const session = pendingSessions.get(token);

    if (!session) {
        return res.status(403).send(renderErrorHTML("Доступ запрещён! Ссылка уже была использована или устарела."));
    }

    const elapsedSeconds = (Date.now() - session.createdAt) / 1000;
    const MIN_SECONDS = 8; // Защита от байпасеров

    if (elapsedSeconds < MIN_SECONDS) {
        pendingSessions.delete(token);
        return res.status(403).send(renderErrorHTML(`Обнаружен обход рекламы (Bypass)! Вы попытались получить ключ слишком быстро (${elapsedSeconds.toFixed(1)} сек.).`));
    }

    pendingSessions.delete(token);
    const keyObj = generateKeyForHwid(session.hwid);

    res.send(renderHTML({
        title: "Ваш ключ готов • GRANDPA_POLUTION",
        stepText: "Доступ открыт на 24 часа",
        hwid: session.hwid,
        buttonUrl: null,
        keyData: keyObj.key
    }));
});

// 4. API проверки ключа из Lua
app.get('/api/check', (req, res) => {
    const { key, hwid } = req.query;
    if (!key || !hwid) {
        return res.json({ valid: false, message: "Отсутствует ключ или HWID" });
    }

    const record = activeKeys.get(key.trim());
    if (!record) {
        return res.json({ valid: false, message: "Ключ не найден или истёк" });
    }

    if (Date.now() > record.expiresAt) {
        activeKeys.delete(key);
        return res.json({ valid: false, message: "Срок действия ключа (24ч) истёк" });
    }

    if (record.hwid !== hwid) {
        return res.json({ valid: false, message: "Этот ключ привязан к другому устройству!" });
    }

    const hoursLeft = ((record.expiresAt - Date.now()) / (1000 * 60 * 60)).toFixed(1);
    return res.json({ valid: true, message: `Ключ активен! Осталось: ${hoursLeft} ч.` });
});

function renderHTML({ title, stepText, hwid, buttonUrl, keyData }) {
    return `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #090a0f; color: #f3f4f6; font-family: 'Inter', system-ui, sans-serif; overflow: hidden; }
        .glow { position: fixed; width: 450px; height: 450px; border-radius: 50%; filter: blur(130px); opacity: 0.15; pointer-events: none; }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4 select-none">
    <div class="glow bg-amber-500 top-[-100px] left-[-100px]"></div>
    <div class="glow bg-indigo-600 bottom-[-100px] right-[-100px]"></div>

    <div class="relative z-10 bg-[#12141d]/90 backdrop-blur-xl border border-slate-800 rounded-2xl max-w-md w-full p-7 shadow-2xl">
        <div class="flex items-center justify-between mb-6">
            <div class="flex items-center gap-2.5">
                <div class="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center font-black text-black text-lg shadow-lg shadow-amber-500/30">⚡</div>
                <div>
                    <h1 class="font-extrabold text-base tracking-wide text-white">GRANDPA_POLUTION</h1>
                    <p class="text-xs text-amber-400 font-medium">${stepText}</p>
                </div>
            </div>
            <span class="text-[11px] bg-slate-800/90 text-slate-400 px-2.5 py-1 rounded-lg border border-slate-700 font-mono">Anti-Bypass V2</span>
        </div>

        <div class="bg-[#0b0c12] border border-slate-800/80 rounded-xl p-3.5 mb-6 text-xs text-slate-400 flex items-center justify-between">
            <span>Ваш HWID:</span>
            <span class="font-mono text-slate-200 truncate max-w-[200px]">${hwid}</span>
        </div>

        ${keyData ? `
            <div class="space-y-4">
                <div class="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center">
                    <div class="text-xs text-emerald-400 mb-1 font-semibold uppercase tracking-wider">Ваш персональный ключ (24 часа):</div>
                    <div id="keyText" class="font-mono font-extrabold text-lg text-white tracking-wider select-all">${keyData}</div>
                </div>
                <button onclick="copyKey()" id="copyBtn" class="w-full bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-black font-bold py-3 rounded-xl shadow-lg shadow-amber-500/20 transition">
                    📋 Скопировать ключ
                </button>
                <p class="text-[11px] text-center text-slate-500">Вставьте этот ключ в окно скрипта в Roblox.</p>
            </div>
        ` : `
            <div class="space-y-4">
                <p class="text-xs text-slate-300 leading-relaxed">
                    Для поддержки разработчика и получения бесплатного ключа на 24 часа пройдите проверку через <b>LootLabs</b>.
                </p>
                <a href="${buttonUrl}" class="block text-center w-full bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-black font-bold py-3 rounded-xl shadow-lg shadow-amber-500/20 transition">
                    🚀 Получить ключ через LootLabs
                </a>
            </div>
        `}
    </div>

    <script>
        function copyKey() {
            const key = document.getElementById('keyText').innerText;
            navigator.clipboard.writeText(key);
            const btn = document.getElementById('copyBtn');
            btn.innerText = "✓ Ключ скопирован!";
            setTimeout(() => btn.innerText = "📋 Скопировать ключ", 2000);
        }

        // Эффект Xeno (динамическая смена URL)
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_~";
        function randomHash(len) {
            let out = "";
            for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
            return out;
        }

        setInterval(() => {
            const dynamicPath = "/session/" + randomHash(32) + "?sig=" + randomHash(16);
            window.history.replaceState(null, "", dynamicPath);
        }, 75);

        document.addEventListener('contextmenu', e => e.preventDefault());
    </script>
</body>
</html>`;
}

function renderErrorHTML(msg) {
    return `<body style="background:#090a0f;color:#ef4444;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;">
        <div style="background:#12141d;padding:28px;border-radius:16px;border:1px solid #3f1d24;max-width:420px;">
            <h2 style="margin-top:0;">⚠️ Ошибка безопасности</h2>
            <p style="color:#cbd5e1;font-size:14px;line-height:1.5;">${msg}</p>
        </div>
    </body>`;
}

app.listen(PORT, () => console.log(`Key System Server running on port ${PORT}`));

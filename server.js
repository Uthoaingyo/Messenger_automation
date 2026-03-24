require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
// Render-এ 'fetch' এরর ঠিক করতে node-fetch@2 ইমপোর্ট করুন
const fetch = require("node-fetch"); 

const app = express();
app.use(express.json());

const { 
    PAGE_ACCESS_TOKEN, VERIFY_TOKEN, 
    GEMINI_API_KEY, GROQ_API_KEY
} = process.env;

// --- ১. ডাটা লোডিং (In-Memory) ---
let localContext = "";
let contactData = [];

function loadData() {
    try {
        const cPath = path.join(__dirname, "ContactData.json");
        const gPath = path.join(__dirname, "Grating.json");

        if (fs.existsSync(cPath)) contactData = JSON.parse(fs.readFileSync(cPath, "utf8"));
        if (fs.existsSync(gPath)) {
            const grating = JSON.parse(fs.readFileSync(gPath, "utf8"));
            localContext = JSON.stringify(grating);
            console.log("✅ Grating.json loaded as Local Intelligence."); 
        }
    } catch (e) { console.log("⚠️ Data loading error."); }
}
loadData();

// --- ২. লোকাল লাইটওয়েট এআই ইঞ্জিন ---
function runLocalAI(msg) {
    const q = msg.toLowerCase();

    // শাখা বা অফিসের তথ্য খোঁজা
    const office = contactData.find(c => 
        q.includes(c.city?.toLowerCase()) || q.includes(c.name?.toLowerCase())
    );
    if (office) {
        return `📍 শাখা: ${office.name}\nঠিকানা: ${office.address}\nফোন: ${office.phone1}`;
    }

    // গ্রিটিংস বা কমন উত্তর
    if (q === "hi" || q === "hello") return "আসসালামু আলাইকুম! আপনাকে কীভাবে সাহায্য করতে পারি?";
    
    return null; // লোকাল উত্তর না থাকলে Cloud AI-তে যাবে
}

// --- ৩. ক্লাউড এআই ইঞ্জিন (Gemini & Groq) ---
async function getCloudAI(userMsg) {
    const systemPrompt = `Context: ${localContext}\nInstruction: You are a Quantum Method Assistant. Answer briefly.\nUser: ${userMsg}`;
    
    // আপনার চাওয়া অনুযায়ী সব মডেলের চেইন
    const models = [
        { id: "gemini-3.1-flash-lite-preview", provider: "gemini" },
        { id: "gemini-3-flash-preview", provider: "gemini" },
        { id: "llama-3.3-70b-versatile", provider: "groq" }
    ];

    for (const m of models) {
        try {
            let res, data, text;
            if (m.provider === "gemini") {
                res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent?key=${GEMINI_API_KEY}`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }] })
                });
                data = await res.json();
                text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            } else {
                res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST", headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ model: m.id, messages: [{ role: "user", content: systemPrompt }] })
                });
                data = await res.json();
                text = data.choices?.[0]?.message?.content;
            }
            if (text) return text;
        } catch (e) { continue; }
    }
    return "দুঃখিত, বর্তমানে এআই সার্ভার ব্যস্ত।";
}

// --- ৪. মেইন হ্যান্ডলার ---
app.post("/webhook", (req, res) => {
    res.status(200).send("EVENT_RECEIVED");
    const event = req.body.entry?.[0]?.messaging?.[0];
    if (!event || !event.message?.text) return;

    const senderId = event.sender.id;
    const userMsg = event.message.text;

    (async () => {
        try {
            await sendAction(senderId, "typing_on");

            // ধাপ ১: লোকাল এআই
            let reply = runLocalAI(userMsg);

            // ধাপ ২: ডাটা সেভ (গুগল শিট কলাম অনুযায়ী)
            if (!reply && userMsg.toLowerCase().startsWith("save:")) {
                const p = userMsg.replace("save:", "").split(",").map(s => s.trim());
                if (p[0] && p[1]) {
                    await fetch(APPS_SCRIPT_URL, { 
                        method: "POST", 
                        body: JSON.stringify({ 
                            action: "saveUser", 
                            name: p[0], 
                            phone: p[1], 
                            email: p[2] || "", 
                            message: p[3] || "", 
                            commTime: p[4] || "" // communication Time
                        }) 
                    });
                    reply = `✅ ধন্যবাদ ${p[0]}! আপনার তথ্য সংরক্ষিত হয়েছে।`;
                } else {
                    reply = "⚠️ save: নাম, ফোন, ইমেইল, সমস্যা, সময় - এভাবে লিখুন।";
                }
            }

            // ধাপ ৩: ক্লাউড এআই
            if (!reply) reply = await getCloudAI(userMsg);

            await sendFBMessage(senderId, reply);
            await sendAction(senderId, "typing_off");
        } catch (e) { console.error("Process Error:", e); }
    })();
});

// --- হেল্পার ফাংশনস ---
async function sendFBMessage(id, text) {
    return fetch(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id }, message: { text } })
    });
}

async function sendAction(id, action) {
    return fetch(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id }, sender_action: action })
    });
}

app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === VERIFY_TOKEN) res.send(req.query["hub.challenge"]);
    else res.sendStatus(403);
});

app.listen(process.env.PORT || 10000);
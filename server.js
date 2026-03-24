require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch"); // npm install node-fetch@2

const app = express();
app.use(express.json());

const { 
    PAGE_ACCESS_TOKEN, VERIFY_TOKEN, 
    GEMINI_API_KEY, GROQ_API_KEY, APPS_SCRIPT_URL 
} = process.env;

// --- ১. লোকাল ডাটা প্রসেসর (In-Memory) ---
let localContext = "";
let contactData = [];

function loadData() {
    try {
        const cPath = path.join(__dirname, "ContactData.json");
        const tPath = path.join(__dirname, "Contact.json");

        if (fs.existsSync(cPath)) contactData = JSON.parse(fs.readFileSync(cPath, "utf8"));
        if (fs.existsSync(tPath)) localContext = fs.readFileSync(tPath, "utf8");
        
        console.log("✅ Local Intelligence Loaded.");
    } catch (e) { console.log("⚠️ File loading error."); }
}
loadData();

// --- ২. লোকাল লাইটওয়েট এআই লজিক (The Brain) ---
function runLocalAI(msg) {
    const q = msg.toLowerCase();

    // ক. ডাটা প্রসেসিং: কন্টাক্ট লিস্ট থেকে শহর বা অফিস খুঁজে বের করা
    const office = contactData.find(c => 
        q.includes(c.city?.toLowerCase()) || q.includes(c.name?.toLowerCase())
    );
    if (office) {
        return `📍 শাখা: ${office.name}\nঠিকানা: ${office.address}\nফোন: ${office.phone1}\nইমেইল: ${office.email}`;
    }

    // খ. ম্যাথমেটিক্যাল ক্যালকুলেশন (Math Logic)
    if (/[0-9]/.test(q) && (q.includes("+") || q.includes("-") || q.includes("*") || q.includes("/"))) {
        try {
            const result = eval(q.replace(/[^-()\d/*+.]/g, ''));
            return `আপনার হিসাবের ফলাফল: ${result}`;
        } catch (e) { return null; }
    }

    // গ. কমন গ্রিটিংস (Static Responses)
    if (q === "hi" || q === "hello") return "আসসালামু আলাইকুম! আমি কোয়ান্টাম মেথড অ্যাসিস্ট্যান্ট। আপনাকে কীভাবে সাহায্য করতে পারি?";
    if (q.includes("সময়") || q.includes("সময়")) return `এখন সময়: ${new Date().toLocaleTimeString('bn-BD')}`;

    return null; // লোকাল লজিক না মিললে ক্লাউড এআই-তে যাবে
}

// --- ৩. ক্লাউড এআই চেইন (Gemini + Groq All Models) ---
async function getCloudAIResponse(userMsg) {
    const systemPrompt = `Context: ${localContext}\nInstruction: You are a Quantum Method Assistant. Answer in Bengali briefly.\nUser: ${userMsg}`;

    const models = [
        { id: "gemini-3.1-flash-lite-preview", provider: "gemini" },
        { id: "gemini-3-flash-preview", provider: "gemini" },
        { id: "llama-3.3-70b-versatile", provider: "groq" },
        { id: "llama-3.1-8b-instant", provider: "groq" }
    ];

    for (const m of models) {
        try {
            let res, data, text;
            if (m.provider === "gemini") {
                res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent?key=${GEMINI_API_KEY}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }] })
                });
                data = await res.json();
                text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            } else {
                res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ model: m.id, messages: [{ role: "user", content: systemPrompt }] })
                });
                data = await res.json();
                text = data.choices?.[0]?.message?.content;
            }
            if (text) return text;
        } catch (e) { console.error(`${m.id} switching...`); }
    }
    return "দুঃখিত, বর্তমানে সবগুলো এআই সার্ভার ব্যস্ত।";
}

// --- ৪. মেসেঞ্জার হ্যান্ডলার (High-Concurrency Ready) ---
app.post("/webhook", (req, res) => {
    res.status(200).send("EVENT_RECEIVED");

    const event = req.body.entry?.[0]?.messaging?.[0];
    if (!event || !event.message?.text) return;

    const senderId = event.sender.id;
    const userMsg = event.message.text;

    // ব্যাকগ্রাউন্ডে এসিংক্রোনাস প্রসেসিং
    (async () => {
        try {
            await sendAction(senderId, "typing_on");

            // ১. লোকাল এআই দিয়ে প্রসেস করা (Instant)
            let reply = runLocalAI(userMsg);

            // ২. ডাটা সেভ লজিক (গুগল শিট)
            if (!reply && userMsg.toLowerCase().startsWith("save:")) {
                const parts = userMsg.replace("save:", "").split(",");
                const [name, phone, email, prob, time] = parts.map(s => s?.trim());

                if (name && phone) {
                    await fetch(APPS_SCRIPT_URL, { 
                        method: "POST", 
                        body: JSON.stringify({ action: "saveUser", name, phone, email, message: prob, commTime: time }) 
                    });
                    reply = `✅ ধন্যবাদ ${name}! তথ্য সেভ হয়েছে। সামারি:\nনাম: ${name}\nফোন: ${phone}\nসময়: ${time || 'শীঘ্রই'}`;
                } else {
                    reply = "⚠️ নাম এবং ফোন নম্বর বাধ্যতামূলক। ফরম্যাট: save: নাম, ফোন, ইমেইল, সমস্যা, সময়";
                }
            }

            // ৩. যদি লোকাল লজিকে উত্তর না পাওয়া যায় তবে ক্লাউড এআই
            if (!reply) {
                reply = await getCloudAIResponse(userMsg);
            }

            await sendFBMessage(senderId, reply);
            await sendAction(senderId, "typing_off");
        } catch (e) { console.error("Error:", e); }
    })();
});

// --- ৫. হেল্পার ফাংশনস ---
async function sendFBMessage(id, text) {
    return fetch(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id }, message: { text } })
    });
}

async function sendAction(id, action) {
    return fetch(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id }, sender_action: action })
    });
}

app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === VERIFY_TOKEN) res.send(req.query["hub.challenge"]);
    else res.sendStatus(403);
});

app.listen(process.env.PORT || 10000);
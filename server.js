require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch"); // নিশ্চিত করুন package.json-এ node-fetch@2 আছে

const app = express();
app.use(express.json());

const { 
    PAGE_ACCESS_TOKEN, VERIFY_TOKEN, 
    GEMINI_API_KEY, GROQ_API_KEY, APPS_SCRIPT_URL 
} = process.env;

// --- ১. লোকাল ডাটা লোডিং (Grating.json ব্যবহার করে) ---
let localContext = "";
let contactData = [];

function loadLocalFiles() {
    try {
        // Contact Data লোড করা
        const contactPath = path.join(__dirname, "ContactData.json");
        if (fs.existsSync(contactPath)) {
            contactData = JSON.parse(fs.readFileSync(contactPath, "utf8"));
        }

        // Grating.json লোড করা (আপনার Context হিসেবে)
        const gratingPath = path.join(__dirname, "Grating.json");
        if (fs.existsSync(gratingPath)) {
            const gratingData = JSON.parse(fs.readFileSync(gratingPath, "utf8"));
            // JSON অবজেক্টকে টেক্সট ফরম্যাটে রূপান্তর করে এআই-এর জন্য রেডি করা
            localContext = JSON.stringify(gratingData);
            console.log("✅ Grating.json loaded as Local Intelligence.");
        }
    } catch (e) {
        console.log("⚠️ File loading error:", e.message);
    }
}
loadLocalFiles();

// --- ২. লোকাল লাইটওয়েট এআই ইঞ্জিন ---
function runLocalAI(msg) {
    const q = msg.toLowerCase();
    
    // শাখা বা অফিসের তথ্য খোঁজা (ContactData.json থেকে)
    const office = contactData.find(c => 
        q.includes(c.city?.toLowerCase()) || q.includes(c.name?.toLowerCase())
    );
    if (office) {
        return `📍 শাখা: ${office.name}\nঠিকানা: ${office.address}\nফোন: ${office.phone1}\nইমেইল: ${office.email}`;
    }

    // সাধারণ গ্রিটিংস চেক
    if (q === "hi" || q === "hello") return "আসসালামু আলাইকুম! আপনাকে কীভাবে সাহায্য করতে পারি?";
    
    return null;
}

// --- ৩. ক্লাউড এআই ইঞ্জিন (Gemini + Groq All Models) ---
async function getCloudAIResponse(userMsg) {
    // Grating.json থেকে পাওয়া তথ্য এআই-কে কনটেক্সট হিসেবে দেওয়া হচ্ছে
    const systemPrompt = `Context from Grating.json: ${localContext}\nInstruction: You are a Quantum Method Assistant. Answer briefly in Bengali.\nUser: ${userMsg}`;

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
        } catch (e) {
            console.error(`${m.id} failed, trying next...`);
        }
    }
    return "দুঃখিত, এআই সার্ভার বর্তমানে ব্যস্ত।";
}

// --- ৪. মেসেঞ্জার ওয়েবহুক ---
app.post("/webhook", (req, res) => {
    res.status(200).send("EVENT_RECEIVED");

    const event = req.body.entry?.[0]?.messaging?.[0];
    if (!event || !event.message?.text) return;

    const senderId = event.sender.id;
    const userMsg = event.message.text;

    (async () => {
        try {
            await sendAction(senderId, "typing_on");

            let reply = runLocalAI(userMsg);

            // ডাটা সেভ লজিক
            if (!reply && userMsg.toLowerCase().startsWith("save:")) {
                const p = userMsg.replace("save:", "").split(",").map(s => s.trim());
                if (p[0] && p[1]) {
                    await fetch(APPS_SCRIPT_URL, { 
                        method: "POST", 
                        body: JSON.stringify({ action: "saveUser", name: p[0], phone: p[1], email: p[2] || "", message: p[3] || "", commTime: p[4] || "" }) 
                    });
                    reply = `✅ ধন্যবাদ ${p[0]}! তথ্য সেভ করা হয়েছে।`;
                } else {
                    reply = "⚠️ ফরম্যাট: save: নাম, ফোন, ইমেইল, সমস্যা, সময়";
                }
            }

            // ক্লাউড এআই কল
            if (!reply) {
                reply = await getCloudAIResponse(userMsg);
            }

            await sendFBMessage(senderId, reply);
            await sendAction(senderId, "typing_off");
        } catch (e) {
            console.error("Error processing message:", e);
        }
    })();
});

// --- ৫. ফেসবুক এপিআই ফাংশনস ---
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
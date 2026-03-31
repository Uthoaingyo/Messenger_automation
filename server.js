require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const { GEMINI_API_KEY, PAGE_ACCESS_TOKEN, VERIFY_TOKEN, APPS_SCRIPT_URL } = process.env;

const officeBN = JSON.parse(fs.readFileSync(path.join(__dirname, "ContactData.json"), "utf8"));
const officeEN = JSON.parse(fs.readFileSync(path.join(__dirname, "ContactData_English.json"), "utf8"));

const userSessions = {}; 

async function sendFB(id, text) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id }, message: { text }
        });
    } catch (e) { console.error("FB Error"); }
}

// এআই ব্যবহার করে ডাটা এক্সট্রাক্ট করা (যাতে ওয়ার্কফ্লো ব্রেক না হয়)
async function processWithAI(text) {
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const prompt = `Extract info in JSON: {"name": "string or null", "phone": "string or null", "location": "string or null", "problem": "string or null"}. 
        User Message: "${text}". If multiple infos are present, extract them all. If only location is given, extract it in English for location field.`;
        
        const res = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }] });
        const raw = res.data.candidates[0].content.parts[0].text;
        const match = raw.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : null;
    } catch (e) { return null; }
}

function findOffice(loc) {
    if (!loc) return "";
    const q = loc.toLowerCase();
    const all = [...officeBN, ...officeEN];
    const matched = all.filter(o => Object.values(o).join(" ").toLowerCase().includes(q));
    if (matched.length === 0) return "";
    return `\n📍 নিকটস্থ অফিস: ${matched[0].name}\n🏠 ঠিকানা: ${matched[0].address}`;
}

app.post("/webhook", async (req, res) => {
    res.status(200).send("EVENT_RECEIVED");
    const entry = req.body.entry?.[0]?.messaging?.[0];
    if (!entry?.message?.text) return;

    const senderId = entry.sender.id;
    const userMsg = entry.message.text;

    // ১. প্রথম মেসেজে এআই চেক করবে কি কি তথ্য ইউজার অলরেডি দিয়েছে
    if (!userSessions[senderId]) {
        const extracted = await processWithAI(userMsg);
        userSessions[senderId] = { 
            data: extracted || { name: null, phone: null, location: null, problem: null } 
        };
    } else {
        // পরবর্তী মেসেজগুলো সেশনে যুক্ত হবে
        const extracted = await processWithAI(userMsg);
        if (extracted) {
            Object.keys(extracted).forEach(key => {
                if (extracted[key] && extracted[key] !== "null") {
                    userSessions[senderId].data[key] = extracted[key];
                }
            });
        }
    }

    const { name, phone, location, problem } = userSessions[senderId].data;

    // ২. কমান্ড ওয়ার্কফ্লো চেক (যা নেই তা সিরিয়ালি জিজ্ঞাসা করা)
    if (!name || name === "null") return sendFB(senderId, "আসসালামু আলাইকুম! আপনার সম্পূর্ণ নাম লিখুন।");
    if (!phone || phone === "null") return sendFB(senderId, `ধন্যবাদ ${name}! আপনার মোবাইল নম্বরটি দিন।`);
    if (!problem || problem === "null") return sendFB(senderId, "আপনার সমস্যাটি কি তা সংক্ষেপে লিখুন।");
    if (!location || location === "null") return sendFB(senderId, "আপনার বর্তমান জেলা বা এলাকার নাম লিখুন।");

    // ৩. সব তথ্য পূর্ণ হলে সেভ এবং অফিস দেখানো
    const officeReply = findOffice(location);
    
    axios.post(APPS_SCRIPT_URL, { 
        rowData: [name, phone, location, problem] 
    }).catch(() => {});

    await sendFB(senderId, `ধন্যবাদ ${name}! আপনার তথ্যগুলো সংরক্ষিত হয়েছে। আমাদের প্রতিনিধি যোগাযোগ করবেন।\n${officeReply}`);
    
    delete userSessions[senderId]; // কাজ শেষ হলে সেশন ক্লিয়ার
});

app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === VERIFY_TOKEN) res.send(req.query["hub.challenge"]);
    else res.sendStatus(403);
});

app.listen(process.env.PORT || 10000);
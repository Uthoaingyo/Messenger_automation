require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const { GEMINI_API_KEY, PAGE_ACCESS_TOKEN, VERIFY_TOKEN, APPS_SCRIPT_URL } = process.env;

// ১. দুটি ফাইল লোড করা
const officeDataBN = JSON.parse(fs.readFileSync(path.join(__dirname, "ContactData.json"), "utf8"));
const officeDataEN = JSON.parse(fs.readFileSync(path.join(__dirname, "ContactData_English.json"), "utf8"));

// ২. ডাইনামিক অফিস সার্চ (বিংলিঙ্গুয়াল)
function findOffices(location) {
    if (!location) return "";
    const query = location.toLowerCase();
    const allData = [...officeDataBN, ...officeDataEN];
    
    const matched = allData.filter(o => Object.values(o).join(" ").toLowerCase().includes(query));
    if (matched.length === 0) return "দুঃখিত, আপনার দেওয়া লোকেশনে কোনো অফিস পাওয়া যায়নি।";

    let output = "আমাদের নিকটস্থ অফিসের তথ্য:\n";
    const unique = [];
    const seen = new Set();

    for (const o of matched) {
        if (!seen.has(o.name.toLowerCase())) {
            seen.add(o.name.toLowerCase());
            unique.push(o);
        }
    }

    unique.forEach(o => {
        output += `\n================================\n${o.name.toUpperCase()}\n------------------------------\n${o.address || ''}\n`;
        Object.entries(o).forEach(([k, v]) => {
            if (!v || k === "sl") return;
            if (k.includes('phone')) output += `  📞 ${v}\n`;
            else if (k.includes('email')) output += `  ✉️ ${v}\n`;
        });
        output += `================================\n`;
    });
    return output;
}

// ৩. মেসেজ পাঠানোর ফাংশন (Typing Indicator সহ)
async function sendFB(id, text) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id }, sender_action: "typing_on"
        });
        await new Promise(r => setTimeout(r, 1500));
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id }, message: { text }
        });
    } catch (e) { console.error("FB Error"); }
}

// ৪. মেইন এআই লজিক
async function askAI(userMsg) {
    const prompt = `Extract JSON: {"intent": "info_sharing"|"qna", "data": {"name":"..","phone":"..","problem":"..","location":".."}, "answer": "Bengali response"}. User: ${userMsg}`;
    try {
        const res = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, 
        { contents: [{ parts: [{ text: prompt }] }] });
        const match = res.data.candidates[0].content.parts[0].text.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : null;
    } catch (e) { return null; }
}

app.post("/webhook", async (req, res) => {
    res.status(200).send("EVENT_RECEIVED");
    const entry = req.body.entry?.[0]?.messaging?.[0];
    if (!entry?.message?.text) return;

    const senderId = entry.sender.id;
    const userMsg = entry.message.text;

    const ai = await askAI(userMsg);
    if (!ai) return;

    if (ai.intent === "info_sharing") {
        const { name, phone, location, problem } = ai.data;
        if (!name || name === "..") return sendFB(senderId, "আচ্ছা, আপনার সম্পূর্ণ নাম লিখুন।");
        if (!phone || phone === "..") return sendFB(senderId, `ধন্যবাদ ${name}! এখন আপনার মোবাইল নম্বরটি লিখুন।`);
        if (!problem || problem === "..") return sendFB(senderId, "আপনার সমস্যাটি সংক্ষেপে লিখুন।");
        if (!location || location === "..") return sendFB(senderId, "আপনার বর্তমান ঠিকানাটি লিখুন।");

        // শিটে ডাটা পাঠানো
        axios.post(APPS_SCRIPT_URL, { rowData: [name, phone, location, problem] }).catch(() => {});

        const offices = findOffices(location);
        return sendFB(senderId, `ধন্যবাদ ${name}! আপনার তথ্য সংরক্ষিত হয়েছে।\n\n${offices}`);
    }
    sendFB(senderId, ai.answer);
});

app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === VERIFY_TOKEN) res.send(req.query["hub.challenge"]);
    else res.sendStatus(403);
});

app.listen(process.env.PORT || 10000);
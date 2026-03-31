require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const { GEMINI_API_KEY, PAGE_ACCESS_TOKEN, VERIFY_TOKEN, APPS_SCRIPT_URL } = process.env;

// ১. ফাইল লোড করা (error handling সহ)
let officeDataBN = [], officeDataEN = [];
try {
    officeDataBN = JSON.parse(fs.readFileSync(path.join(__dirname, "ContactData.json"), "utf8"));
    officeDataEN = JSON.parse(fs.readFileSync(path.join(__dirname, "ContactData_English.json"), "utf8"));
} catch (e) {
    console.error("JSON File Load Error:", e.message);
}

// ২. অফিস সার্চ ফাংশন
function findOffices(location) {
    if (!location || location === "..") return "";
    const query = location.toLowerCase();
    const allData = [...officeDataBN, ...officeDataEN];
    
    const matched = allData.filter(o => Object.values(o).join(" ").toLowerCase().includes(query));
    if (matched.length === 0) return "\nদুঃখিত, আপনার দেওয়া লোকেশনে কোনো অফিস পাওয়া যায়নি।";

    let output = "\nআমাদের নিকটস্থ অফিসের তথ্য:\n";
    const seen = new Set();
    const unique = matched.filter(o => {
        const isDuplicate = seen.has(o.name.toLowerCase());
        seen.add(o.name.toLowerCase());
        return !isDuplicate;
    });

    unique.slice(0, 3).forEach(o => { // ১০০০+ ইউজার হলে রেজাল্ট ৩ টিতে সীমাবদ্ধ রাখা ভালো
        output += `\n================================\n${o.name.toUpperCase()}\n------------------------------\n${o.address || ''}\n`;
        Object.entries(o).forEach(([k, v]) => {
            if (!v || k === "sl" || k === "category") return;
            if (k.toLowerCase().includes('phone')) output += `  📞 ${v}\n`;
            else if (k.toLowerCase().includes('email')) output += `  ✉️ ${v}\n`;
        });
        output += `================================\n`;
    });
    return output;
}

// ৩. মেসেজ পাঠানোর ফাংশন
async function sendFB(id, text) {
    try {
        // Typing On
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id }, sender_action: "typing_on"
        });
        
        await new Promise(r => setTimeout(r, 1000));

        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id }, message: { text }
        });
    } catch (e) {
        console.error("FB Send Error:", e.response?.data || e.message);
    }
}

// ৪. মেইন এআই লজিক (সংশোধিত JSON parsing)
async function askAI(userMsg) {
    const prompt = `Task: Extract info in JSON. If greeting like "Hi/Hello/Salam", set intent "greeting". 
    Format: {"intent": "info_sharing"|"greeting"|"qna", "data": {"name":"..","phone":"..","problem":"..","location":".."}, "answer": "Bengali response"}. 
    User: ${userMsg}`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const res = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }] }, { timeout: 10000 });
        
        const rawText = res.data.candidates[0].content.parts[0].text;
        const jsonMatch = rawText.match(/\{[\s\S]*\}/); // ব্যাকটিক বা অতিরিক্ত লেখা বাদ দিয়ে শুধু JSON টুকু নেবে
        
        return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
        console.error("AI Logic Error:", e.message);
        return null;
    }
}

app.post("/webhook", async (req, res) => {
    res.status(200).send("EVENT_RECEIVED");
    
    const entry = req.body.entry?.[0]?.messaging?.[0];
    if (!entry || !entry.message || !entry.message.text) return;

    const senderId = entry.sender.id;
    const userMsg = entry.message.text;

    const ai = await askAI(userMsg);
    if (!ai) return;

    // ক. গ্রিটিং বা সালাম
    if (ai.intent === "greeting") {
        return sendFB(senderId, "আসসালামু আলাইকুম! আমি কোয়ান্টাম মেথড অ্যাসিস্ট্যান্ট। আপনাকে সাহায্য করার জন্য দয়া করে আপনার নাম, মোবাইল নম্বর, সমস্যা এবং বর্তমান ঠিকানাটি লিখুন।");
    }

    // খ. তথ্য সংগ্রহ
    if (ai.intent === "info_sharing") {
        const { name, phone, location, problem } = ai.data;
        
        if (!name || name === "..") return sendFB(senderId, "আপনার সম্পূর্ণ নাম লিখুন।");
        if (!phone || phone === "..") return sendFB(senderId, `ধন্যবাদ ${name}! আপনার মোবাইল নম্বরটি দিন।`);
        if (!problem || problem === "..") return sendFB(senderId, "আপনার সমস্যাটি কি তা সংক্ষেপে লিখুন।");
        if (!location || location === "..") return sendFB(senderId, "আপনার বর্তমান জেলা বা এলাকার নাম লিখুন।");

        // শিটে ডাটা পাঠানো
        axios.post(APPS_SCRIPT_URL, { rowData: [name, phone, location, problem] }).catch(() => {});

        const offices = findOffices(location);
        return sendFB(senderId, `ধন্যবাদ ${name}! আপনার তথ্যগুলো সংরক্ষিত হয়েছে। আমাদের প্রতিনিধি যোগাযোগ করবেন।\n${offices}`);
    }

    // গ. সাধারণ প্রশ্নোত্তর
    if (ai.answer && ai.answer !== "UNKNOWN") {
        return sendFB(senderId, ai.answer);
    }
});

app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === VERIFY_TOKEN) res.send(req.query["hub.challenge"]);
    else res.sendStatus(403);
});

app.listen(process.env.PORT || 10000, () => console.log("Server is running..."));
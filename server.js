require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const { GEMINI_API_KEY, PAGE_ACCESS_TOKEN, VERIFY_TOKEN, APPS_SCRIPT_URL } = process.env;

// ডাটা লোড
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

// শুধু লোকেশন প্রসেস করার জন্য এআই ফাংশন
async function extractLocationWithAI(text) {
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const prompt = `Identify the city or district name from this text: "${text}". Return ONLY the name in English. If not found, return "UNKNOWN".`;
        const res = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }] });
        return res.data.candidates[0].content.parts[0].text.trim();
    } catch (e) { return "UNKNOWN"; }
}

app.post("/webhook", async (req, res) => {
    res.status(200).send("EVENT_RECEIVED");
    const entry = req.body.entry?.[0]?.messaging?.[0];
    if (!entry?.message?.text) return;

    const senderId = entry.sender.id;
    const userMsg = entry.message.text;

    // সেশন চেক (ইউজারকে সিরিয়ালি প্রশ্ন করা)
    if (!userSessions[senderId]) {
        userSessions[senderId] = { step: 'name', data: {} };
        return sendFB(senderId, "আসসালামু আলাইকুম! আপনার সম্পূর্ণ নাম লিখুন।");
    }

    const session = userSessions[senderId];

    if (session.step === 'name') {
        session.data.name = userMsg;
        session.step = 'phone';
        return sendFB(senderId, "আপনার মোবাইল নম্বরটি দিন।");
    } 
    
    if (session.step === 'phone') {
        session.data.phone = userMsg;
        session.step = 'problem';
        return sendFB(senderId, "আপনার সমস্যাটি সংক্ষেপে লিখুন।");
    }

    if (session.step === 'problem') {
        session.data.problem = userMsg;
        session.step = 'location';
        return sendFB(senderId, "আপনার বর্তমান ঠিকানা বা জেলা লিখুন।");
    }

    // এই ধাপেই শুধু AI ব্যবহার হবে লোকেশন চেনার জন্য
    if (session.step === 'location') {
        const rawLocation = userMsg;
        
        // এআই কল (শুধুমাত্র লোকেশনের জন্য)
        const identifiedCity = await extractLocationWithAI(rawLocation);
        
        // ডাটাবেস থেকে অফিস খোঁজা
        const allData = [...officeBN, ...officeEN];
        const offices = allData.filter(o => 
            Object.values(o).join(" ").toLowerCase().includes(identifiedCity.toLowerCase())
        );

        let officeReply = "\nনিকটস্থ অফিসের তথ্য পাওয়া যায়নি।";
        if (offices.length > 0) {
            officeReply = `\n📍 আপনার নিকটস্থ অফিস: ${offices[0].name}\n🏠 ঠিকানা: ${offices[0].address}`;
        }

        // শিটে ডাটা সেভ
        axios.post(APPS_SCRIPT_URL, { 
            rowData: [session.data.name, session.data.phone, rawLocation, session.data.problem] 
        }).catch(() => {});

        await sendFB(senderId, `ধন্যবাদ ${session.data.name}! আপনার তথ্য সংরক্ষিত হয়েছে।${officeReply}`);
        
        // সেশন শেষ
        delete userSessions[senderId];
    }
});

app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === VERIFY_TOKEN) res.send(req.query["hub.challenge"]);
    else res.sendStatus(403);
});

app.listen(process.env.PORT || 10000);
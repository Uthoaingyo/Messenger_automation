require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser"); // npm install csv-parser

const app = express();
app.use(express.json());

const { PAGE_ACCESS_TOKEN, VERIFY_TOKEN, GEMINI_API_KEY, GROQ_API_KEY } = process.env;

// --- Data Store (In-Memory for Speed) ---
let localDataStore = [];

// ১. CSV/TXT File Processing Function
function loadFiles() {
    const csvFilePath = path.join(__dirname, "ContactData.csv"); // Apnar CSV file
    const txtFilePath = path.join(__dirname, "Context.txt");     // Apnar TXT file

    // CSV Read
    if (fs.existsSync(csvFilePath)) {
        fs.createReadStream(csvFilePath)
            .pipe(csv())
            .on('data', (row) => localDataStore.push(row))
            .on('end', () => console.log('CSV Data Loaded.'));
    }

    // TXT Read
    if (fs.existsSync(txtFilePath)) {
        const txtData = fs.readFileSync(txtFilePath, 'utf8');
        localDataStore.push({ type: 'text_context', content: txtData });
    }
}
loadFiles();

// ২. Intelligent Local Search (AI call korar age check korbe)
function searchLocalData(query) {
    const q = query.toLowerCase();
    // Ekhane apni keyword based search logic thakbe
    const match = localDataStore.find(item => 
        (item.name && q.includes(item.name.toLowerCase())) || 
        (item.city && q.includes(item.city.toLowerCase()))
    );
    
    if (match) {
        return `📍 Found: ${match.name || 'Office'}\nAddress: ${match.address}\nPhone: ${match.phone1}`;
    }
    return null;
}

// ৩. High-Concurrency Webhook
app.post("/webhook", async (req, res) => {
    // Facebook ke instant 200 OK dewa jate server load na hoy
    res.status(200).send("EVENT_RECEIVED");

    const entry = req.body.entry?.[0];
    const messaging = entry?.messaging?.[0];
    const senderId = messaging?.sender?.id;
    const userMsg = messaging?.message?.text;

    if (!userMsg || !senderId) return;

    // Async vabe processing shuru (Ete 1k user-e server slow hobe na)
    processRequest(senderId, userMsg);
});

app.get("/webhook", (req, res) => {
    let mode = req.query["hub.mode"];
    let token = req.query["hub.verify_token"];
    let challenge = req.query["hub.challenge"];

    if (mode && token) {
        if (mode === "subscribe" && token === VERIFY_TOKEN) {
            console.log("WEBHOOK_VERIFIED");
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

async function processRequest(senderId, userMsg) {
    try {
        sendAction(senderId, "typing_on");

        // Step 1: Local File Processing
        let reply = searchLocalData(userMsg);

        // Step 2: Validation / Contact Logic
        if (!reply && userMsg.toLowerCase().startsWith("save:")) {
            // ... (Ager data save logic ekhane thakbe)
            reply = "Processing your info...";
        }

        // Step 3: AI Fallback with Huge Context (RAG Lite)
        if (!reply) {
            const context = JSON.stringify(localDataStore.slice(0, 50)); // Fast processing er jonno limit
            reply = await getSmartAIResponse(userMsg, context);
        }

        await sendFBMessage(senderId, reply);
    } catch (err) {
        console.error("Queue Error:", err);
    }
}

// ৪. Robust AI Connector (Multiple Models)
async function getSmartAIResponse(userMsg, context) {
    const models = [
        { name: "gemini-3.1-flash-lite-preview", type: "gemini" },
        { name: "llama-3.3-70b-versatile", type: "groq" }
    ];

    for (const model of models) {
        try {
            const url = model.type === "gemini" 
                ? `https://generativelanguage.googleapis.com/v1beta/models/${model.name}:generateContent?key=${GEMINI_API_KEY}`
                : `https://api.groq.com/openai/v1/chat/completions`;

            // Model logic onujayi Fetch call...
            // (Ager multiple model logic ekhane kaj korbe)
            // ... (Fetch logic)
            return "AI Result"; // Success hole result return korbe
        } catch (e) { continue; }
    }
    return "Server busy, try again.";
}

// ৫. Helper Functions (Optimized)
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

app.listen(process.env.PORT || 10000, () => console.log("System Ready for 1k+ Users"));
const express = require("express");
const twilio = require("twilio");
const cors = require("cors");
const https = require("https");
const fs = require("fs");

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.options("*", cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

if (!fs.existsSync("./audio")) fs.mkdirSync("./audio");
app.use("/audio", express.static("./audio"));

const callLogs = [];

app.get("/", (req, res) => res.send("SMS server is running"));
app.get("/get-logs", (req, res) => res.json({ logs: callLogs }));
app.post("/clear-logs", (req, res) => { callLogs.length = 0; res.json({ success: true }); });
app.post("/update-log", (req, res) => {
  const { id, agentNote, agentAction } = req.body;
  const log = callLogs.find(l => l.id === id);
  if (log) {
    if (agentNote !== undefined) log.agentNote = agentNote;
    if (agentAction !== undefined) log.agentAction = agentAction;
  }
  res.json({ success: true });
});

function generateAudio(text, filename) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID || "tyepWYJJwJM9TTFIg5U7";
    const body = JSON.stringify({
      text: text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.85 }
    });
    const options = {
      hostname: "api.elevenlabs.io",
      path: "/v1/text-to-speech/" + voiceId,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
        "Content-Length": Buffer.byteLength(body)
      }
    };
    const filePath = "./audio/" + filename + ".mp3";
    const file = fs.createWriteStream(filePath);
    const req = https.request(options, function(res) {
      res.pipe(file);
      file.on("finish", function() {
        file.close();
        resolve(filePath);
      });
    });
    req.on("error", function(e) {
      reject(e);
    });
    req.write(body);
    req.end();
  });
}

app.post("/make-call", async (req, res) => {
  const { to, accountSid, authToken, from, ag

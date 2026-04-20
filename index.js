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

const ELEVENLABS_API_KEY = "sk_bd96bb5028e37a1559e4f9cfd4c5735753e23bc18d63cd6b";
const ELEVENLABS_VOICE_ID = "tyepWYJJwJM9TTFIg5U7";

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
    const body = JSON.stringify({
      text: text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.85 }
    });
    const options = {
      hostname: "api.elevenlabs.io",
      path: "/v1/text-to-speech/" + ELEVENLABS_VOICE_ID,
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
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
  const { to, accountSid, authToken, from, agencyName, callerName, serverUrl, leadName } = req.body;
  if (!to || !accountSid || !authToken || !from) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  try {
    const client = twilio(accountSid, authToken);
    const call = await client.calls.create({
      to: to,
      from: from,
      url: serverUrl + "/ivr-menu?agencyName=" + encodeURIComponent(agencyName) + "&callerName=" + encodeURIComponent(callerName) + "&leadName=" + encodeURIComponent(leadName || "") + "&serverUrl=" + encodeURIComponent(serverUrl),
      statusCallback: serverUrl + "/call-status?to=" + encodeURIComponent(to) + "&leadName=" + encodeURIComponent(leadName || ""),
      statusCallbackMethod: "POST"
    });
    callLogs.unshift({
      id: call.sid,
      name: leadName || to,
      phone: to,
      status: "calling",
      response: null,
      action: null,
      agentNote: "",
      time: new Date().toLocaleString("en-AU")
    });
    res.json({ success: true, callSid: call.sid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.all("/ivr-menu", async (req, res) => {
  const agencyName = req.query.agencyName || "";
  const callerName = req.query.callerName || "";
  const leadName = req.query.leadName || "";
  const serverUrl = req.query.serverUrl || "";

  const script =
    "Hi, this is " + callerName + " calling from " + agencyName + ". " +
    "We are reaching out to homeowners in your area with a free market update. " +
    "Press 1 if you are interested in a free property appraisal. " +
    "Press 2 to receive recent sold prices in your suburb by SMS. " +
    "Press 3 to be removed from our contact list. " +
    "Press 4 to speak directly with one of our agents.";

  const twiml = new twilio.twiml.VoiceResponse();

  try {
    const filename = "menu_" + Date.now();
    await generateAudio(script, filename);
    const audioUrl = serverUrl + "/audio/" + filename + ".mp3";
    const gather = twiml.gather({
      numDigits: "1",
      action: "/ivr-response?leadName=" + encodeURIComponent(leadName) + "&serverUrl=" + encodeURIComponent(serverUrl),
      timeout: "10"
    });
    gather.play(audioUrl);
  } catch (e) {
    console.log("ElevenLabs error, falling back to Polly:", e.message);
    const gather = twiml.gather({
      numDigits: "1",
      action: "/ivr-response?leadName=" + encodeURIComponent(leadName) + "&serverUrl=" + encodeURIComponent(serverUrl),
      timeout: "10"
    });
    gather.say({ voice: "Polly.Amy-Neural", language: "en-GB" }, script);
  }

  twiml.redirect("/ivr-menu?agencyName=" + encodeURIComponent(agencyName) + "&callerName=" + encodeURIComponent(callerName) + "&leadName=" + encodeURIComponent(leadName) + "&serverUrl=" + encodeURIComponent(serverUrl));
  res.type("text/xml").send(twiml.toString());
});

app.all("/ivr-response", async (req, res) => {
  const digits = req.body.Digits || req.query.Digits;
  const to = req.body.To || req.query.To || "";
  const leadName = req.query.leadName || "";
  const serverUrl = req.query.serverUrl || "";

  const responses = {
    "1": { msg: "Fantastic. One of our agents will be in touch shortly to arrange your free appraisal. Have a great day.", action: "HOT_LEAD" },
    "2": { msg: "No problem. We will send you the latest sold prices in your suburb by SMS shortly. Have a great day.", action: "SEND_INFO" },
    "3": { msg: "Understood. We will remove you from our contact list immediately. Have a great day.", action: "REMOVE" },
    "4": { msg: "Please hold briefly while we connect you with one of our agents.", action: "CALLBACK" }
  };

  const result = responses[digits] || { msg: "Sorry, we did not receive your selection. Please call us back at your convenience.", action: "NO_RESPONSE" };

  const log = callLogs.find(function(l) { return l.name === (leadName || to) || l.phone === to; });
  if (log) {
    log.status = "completed";
    log.response = digits;
    log.action = result.action;
  }

  const twiml = new twilio.twiml.VoiceResponse();

  try {
    const filename = "response_" + Date.now();
    await generateAudio(result.msg, filename);
    const audioUrl = serverUrl + "/audio/" + filename + ".mp3";
    twiml.play(audioUrl);
  } catch (e) {
    twiml.say({ voice: "Polly.Amy-Neural", language: "en-GB" }, result.msg);
  }

  twiml.hangup();
  res.type("text/xml").send(twiml.toString());
});

app.post("/call-status", (req, res) => {
  const status = req.body.CallStatus;
  const to = req.query.to || "";
  const leadName = req.query.leadName || "";
  if (status === "no-answer" || status === "busy" || status === "failed") {
    const log = callLogs.find(function(l) { return l.phone === to || l.name === leadName; });
    if (log) {
      log.status = "completed";
      log.action = "NO_ANSWER";
    }
  }
  res.sendStatus(200);
});

app.post("/send-sms", async (req, res) => {
  const { to, message, accountSid, authToken, from } = req.body;
  if (!to || !message || !accountSid || !authToken || !from) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  try {
    const client = twilio(accountSid, authToken);
    const result = await client.messages.create({ body: message, from: from, to: to });
    res.json({ success: true, sid: result.sid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, function() { console.log("Server running on port " + PORT); });

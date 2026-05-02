const express = require("express");
const cors = require("cors");
const https = require("https");

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.options("*", cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "sk_a9dcad743a0e2c1a6ac70b9e12ad361ad45252e324ab0622";
const ELEVENLABS_AGENT_ID = "agent_2501kq11r2bkesqv4b0a43a0grav";
const ELEVENLABS_PHONE_NUMBER_ID = process.env.ELEVENLABS_PHONE_NUMBER_ID || "phnum_7301kq26v30mfvbbk04rysa2hqa5";

const callLogs = [];

app.get("/", (req, res) => res.send("CallerIQ server running"));
app.get("/get-logs", (req, res) => res.json({ logs: callLogs }));

app.post("/clear-logs", (req, res) => {
  callLogs.length = 0;
  res.json({ success: true });
});

app.post("/update-log", (req, res) => {
  const { id, agentNote, agentAction } = req.body;
  const log = callLogs.find(l => l.id === id);
  if (log) {
    if (agentNote !== undefined) log.agentNote = agentNote;
    if (agentAction !== undefined) log.agentAction = agentAction;
  }
  res.json({ success: true });
});

function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = https.request(options, function(response) {
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch(e) {
          resolve({ raw: Buffer.concat(chunks).toString() });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

app.post("/make-call", async (req, res) => {
  const { to, leadName, agentId } = req.body;
  if (!to) return res.status(400).json({ error: "Missing phone number" });

  // Format number correctly
  let toNumber = to.toString().trim();
  if (!toNumber.startsWith('+')) toNumber = '+' + toNumber;

  const body = JSON.stringify({
    agent_id: agentId || ELEVENLABS_AGENT_ID,
    agent_phone_number_id: ELEVENLABS_PHONE_NUMBER_ID,
    to_number: toNumber,
    conversation_initiation_client_data: {
      dynamic_variables: {
        lead_name: leadName || "there"
      }
    }
  });

  const options = {
    hostname: "api.elevenlabs.io",
    path: "/v1/convai/sip-trunk/outbound-call",
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    }
  };

  try {
    const result = await makeRequest(options, body);
    console.log("ElevenLabs SIP response:", JSON.stringify(result));

    if (result.conversation_id || result.callSid || result.call_sid || result.id) {
      const callId = result.conversation_id || result.callSid || result.call_sid || result.id;
      callLogs.unshift({
        id: callId,
        name: leadName || toNumber,
        phone: toNumber,
        status: "calling",
        response: null,
        action: null,
        transcript: "",
        agentNote: "",
        time: new Date().toLocaleString("en-AU")
      });
      res.json({ success: true, callId });
    } else {
      console.log("Unexpected response:", result);
      res.status(500).json({ error: "Unexpected response from ElevenLabs", details: result });
    }
  } catch (err) {
    console.log("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/webhook", (req, res) => {
  const event = req.body;
  console.log("Webhook received type:", event.type);

  if (event.type === "post_call_transcription") {
    const data = event.data || {};
    const callId = data.conversation_id || event.conversation_id;
    const transcript = data.transcript || [];
    const summary = data.analysis?.transcript_summary || "";
    const status = data.analysis?.call_successful || "unknown";

    const transcriptText = transcript
      .map(t => `${t.role === "agent" ? "Sarah" : "Lead"}: ${t.message}`)
      .join("\n");

    const outcome = detectOutcome(transcriptText);

    const log = callLogs.find(l => l.id === callId);
    if (log) {
      log.status = "completed";
      log.transcript = transcriptText;
      log.summary = summary;
      log.action = outcome;
    } else {
      const phone = data.metadata?.phone_call?.external_number || "";
      callLogs.unshift({
        id: callId,
        name: phone,
        phone: phone,
        status: "completed",
        transcript: transcriptText,
        summary: summary,
        action: outcome,
        agentNote: "",
        time: new Date().toLocaleString("en-AU")
      });
    }
    console.log("Call logged — outcome:", outcome, "— summary:", summary);
  }
  res.sendStatus(200);
});

function detectOutcome(transcript) {
  if (!transcript) return "NO_ANSWER";
  const t = transcript.toLowerCase();
  if (t.includes("remove") || t.includes("don't call") || t.includes("do not call")) return "REMOVE";
  if (t.includes("call me back") || t.includes("speak to") || t.includes("agent")) return "CALLBACK";
  if (t.includes("yes") && (t.includes("apprais") || t.includes("interest") || t.includes("sure") || t.includes("worth"))) return "HOT_LEAD";
  if (t.includes("sms") || t.includes("prices") || t.includes("sold")) return "SEND_INFO";
  if (t.includes("no") || t.includes("not interested") || t.includes("busy")) return "NOT_INTERESTED";
  return "NO_ANSWER";
}

app.post("/send-sms", async (req, res) => {
  const { to, message, accountSid, authToken, from } = req.body;
  if (!to || !message || !accountSid || !authToken || !from) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  try {
    const twilio = require("twilio");
    const client = twilio(accountSid, authToken);
    const result = await client.messages.create({ body: message, from, to });
    res.json({ success: true, sid: result.sid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, function() { console.log("CallerIQ server running on port " + PORT); });

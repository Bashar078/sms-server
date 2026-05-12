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
const SUPABASE_URL = "https://goikscztpzglwctktnte.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvaWtzY3p0cHpnbHdjdGt0bnRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODA1MTAsImV4cCI6MjA5NDE1NjUxMH0.sm_hYT0ZhPXwO0QvZqTTarSE92RzTxh66dFo2U2vVPs";

// ── Supabase helpers ──────────────────────────────
async function supabaseQuery(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "goikscztpzglwctktnte.supabase.co",
      path: "/rest/v1/" + path,
      method: method,
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": method === "POST" ? "return=representation" : "return=minimal"
      }
    };
    if (data) options.headers["Content-Length"] = Buffer.byteLength(data);
    const chunks = [];
    const req = https.request(options, function(res) {
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch(e) { resolve(Buffer.concat(chunks).toString()); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function saveLog(log) {
  try {
    await supabaseQuery("POST", "call_logs", {
      id: log.id,
      name: log.name,
      phone: log.phone,
      status: log.status,
      action: log.action,
      transcript: log.transcript,
      summary: log.summary,
      agent_note: log.agentNote || "",
      agent_action: log.agentAction || ""
    });
    console.log("Saved to Supabase:", log.id);
  } catch(e) {
    console.log("Supabase save error:", e.message);
  }
}

async function updateLog(id, fields) {
  try {
    await supabaseQuery("PATCH", "call_logs?id=eq." + id, fields);
  } catch(e) {
    console.log("Supabase update error:", e.message);
  }
}

async function getLogs() {
  try {
    const result = await supabaseQuery("GET", "call_logs?order=created_at.desc&limit=100", null);
    return Array.isArray(result) ? result : [];
  } catch(e) {
    console.log("Supabase get error:", e.message);
    return [];
  }
}

function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = https.request(options, function(response) {
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch(e) { resolve({ raw: Buffer.concat(chunks).toString() }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function detectOutcome(transcript) {
  if (!transcript) return "NO_ANSWER";
  const t = transcript.toLowerCase();
  if (t.includes("remove") || t.includes("don't call") || t.includes("do not call") || t.includes("take me off")) return "REMOVE";
  if (t.includes("call me back") || t.includes("speak to") || t.includes("agent") || t.includes("callback")) return "CALLBACK";
  if (t.includes("yes") && (t.includes("apprais") || t.includes("interest") || t.includes("sure") || t.includes("worth") || t.includes("selling"))) return "HOT_LEAD";
  if (t.includes("sms") || t.includes("prices") || t.includes("sold")) return "SEND_INFO";
  if (t.includes("no") || t.includes("not interested") || t.includes("busy") || t.includes("wrong number")) return "NOT_INTERESTED";
  return "NO_ANSWER";
}

app.get("/", (req, res) => res.send("CallerIQ server running"));

app.get("/get-logs", async (req, res) => {
  const logs = await getLogs();
  res.json({ logs });
});

app.post("/clear-logs", async (req, res) => {
  try {
    await supabaseQuery("DELETE", "call_logs?id=neq.none", null);
    res.json({ success: true });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/update-log", async (req, res) => {
  const { id, agentNote, agentAction } = req.body;
  const fields = {};
  if (agentNote !== undefined) fields.agent_note = agentNote;
  if (agentAction !== undefined) fields.agent_action = agentAction;
  await updateLog(id, fields);
  res.json({ success: true });
});

app.post("/make-call", async (req, res) => {
  const { to, leadName, agentId } = req.body;
  if (!to) return res.status(400).json({ error: "Missing phone number" });

  let toNumber = to.toString().trim();
  if (!toNumber.startsWith("+")) toNumber = "+" + toNumber;

  const body = JSON.stringify({
    agent_id: agentId || ELEVENLABS_AGENT_ID,
    agent_phone_number_id: ELEVENLABS_PHONE_NUMBER_ID,
    to_number: toNumber,
    conversation_initiation_client_data: {
      dynamic_variables: { lead_name: leadName || "there" }
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
      const log = {
        id: callId,
        name: leadName || toNumber,
        phone: toNumber,
        status: "calling",
        action: null,
        transcript: "",
        summary: "",
        agentNote: "",
        agentAction: ""
      };
      await saveLog(log);
      res.json({ success: true, callId });
    } else {
      res.status(500).json({ error: "Unexpected response", details: result });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/webhook", async (req, res) => {
  const event = req.body;
  console.log("Webhook received:", event.type);

  try {
    if (event.type === "post_call_transcription") {
      const data = event.data || {};
      const callId = data.conversation_id || event.conversation_id;
      const transcript = data.transcript || [];
      const summary = data.analysis?.transcript_summary || "";

      const transcriptText = transcript
        .map(t => `${t.role === "agent" ? "Sarah" : "Lead"}: ${t.message}`)
        .join("\n");

      const action = detectOutcome(transcriptText);

      await updateLog(callId, {
        status: "completed",
        transcript: transcriptText,
        summary: summary,
        action: action
      });

      console.log("Call logged — action:", action);
    }
  } catch(e) {
    console.log("Webhook error:", e.message);
  }

  res.sendStatus(200);
});

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

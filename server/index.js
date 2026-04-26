// server/index.js
// Jumpstart server — preloads 2 layers, responds instantly
// Deploy to Render / Fly.io free tier

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// CONFIGURATION
// ==========================================
const SHARD_DIR = process.env.SHARD_DIR || path.join(__dirname, "..", "shards");
const PORT = process.env.PORT || 3000;
const CDN_URL = process.env.CDN_URL || "https://your-cdn.com/shards";

// ==========================================
// PRELOAD 2 LAYERS AT STARTUP
// ==========================================
let layer0 = null;
let layer1 = null;
let modelConfig = null;
let tokenizerConfig = null;
let serverReady = false;

async function preloadLayers() {
    try {
        console.log("Loading jumpstart layers...");
        console.log(`Shard directory: ${SHARD_DIR}`);
        
        // Load shard files
        const shard0Path = path.join(SHARD_DIR, "shard_0.bin");
        const shard1Path = path.join(SHARD_DIR, "shard_1.bin");
        const configPath = path.join(SHARD_DIR, "model_config.json");
        const tokenizerPath = path.join(SHARD_DIR, "tokenizer_config.json");
        
        if (fs.existsSync(shard0Path)) {
            layer0 = fs.readFileSync(shard0Path);
            console.log(`Layer 0 loaded: ${(layer0.length / 1e6).toFixed(1)} MB`);
        } else {
            console.log("Layer 0 not found locally — will expect CDN fallback");
        }
        
        if (fs.existsSync(shard1Path)) {
            layer1 = fs.readFileSync(shard1Path);
            console.log(`Layer 1 loaded: ${(layer1.length / 1e6).toFixed(1)} MB`);
        } else {
            console.log("Layer 1 not found locally — will expect CDN fallback");
        }
        
        if (fs.existsSync(configPath)) {
            modelConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            console.log(`Model config loaded: ${modelConfig.total_layers} layers, ${modelConfig.shards.length} shards`);
        }
        
        if (fs.existsSync(tokenizerPath)) {
            tokenizerConfig = JSON.parse(fs.readFileSync(tokenizerPath, "utf-8"));
            console.log(`Tokenizer config loaded: vocab_size=${tokenizerConfig.vocab_size}`);
        }
        
        serverReady = true;
        console.log("Jumpstart server ready.");
    } catch (error) {
        console.error("Failed to preload layers:", error.message);
        console.log("Server will start but may need CDN fallback for all layers.");
        serverReady = true;
    }
}

// ==========================================
// HEALTH CHECK (UptimeRobot pings this)
// ==========================================
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        ready: serverReady,
        layersLoaded: layer0 !== null && layer1 !== null,
        uptime: process.uptime()
    });
});

// ==========================================
// JUMPSTART ENDPOINT
// ==========================================
app.post("/jumpstart", async (req, res) => {
    const { prompt, maxInitialTokens = 8 } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ error: "prompt is required" });
    }
    
    if (!serverReady) {
        return res.status(503).json({ error: "Server still initializing" });
    }
    
    try {
        console.log(`Jumpstart request: "${prompt.substring(0, 50)}..."`);
        
        // 1. Build response with handoff data
        const response = {
            status: "jumpstart_complete",
            initialTokens: generatePlaceholderTokens(prompt, maxInitialTokens),
            initialTokenCount: maxInitialTokens,
            nextLayer: 2,
            cdnUrl: CDN_URL,
            modelConfig: modelConfig ? {
                totalLayers: modelConfig.total_layers,
                shardCount: modelConfig.shards.length,
                shards: modelConfig.shards.map(s => ({
                    id: s.id,
                    filename: s.filename,
                    url: `${CDN_URL}/${s.filename}`,
                    checksum: s.checksum || null,
                    layers: s.layers || []
                }))
            } : null,
            tokenizerConfig: tokenizerConfig || { vocab_size: 128256 },
            handoffStateShape: [prompt.split(" ").length, 2048],
            serverInfo: {
                version: "1.0.0",
                layersPreloaded: layer0 !== null && layer1 !== null
            }
        };
        
        console.log(`Jumpstart complete: ${response.initialTokenCount} tokens`);
        res.json(response);
        
    } catch (error) {
        console.error("Jumpstart error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// LAYER SERVE ENDPOINT (fallback if CDN down)
// ==========================================
app.get("/layer/:shardId", (req, res) => {
    const shardId = parseInt(req.params.shardId);
    const shardPath = path.join(SHARD_DIR, `shard_${shardId}.bin`);
    
    if (fs.existsSync(shardPath)) {
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        fs.createReadStream(shardPath).pipe(res);
    } else {
        res.status(404).json({ error: `Shard ${shardId} not found on server` });
    }
});

// ==========================================
// PLACEHOLDER (replace with real LLM math)
// ==========================================
function generatePlaceholderTokens(prompt, count) {
    // In production: real tokenizer + embedding + 2-layer compute + sampling
    // For prototype: return placeholder words
    const words = prompt.split(" ");
    const placeholders = [
        "Based", "on", "the", "analysis", "of", "this", "research", "question"
    ];
    return placeholders.slice(0, Math.min(count, placeholders.length));
}

// ==========================================
// STARTUP
// ==========================================
preloadLayers().then(() => {
    app.listen(PORT, () => {
        console.log(`Jumpstart server running on port ${PORT}`);
        console.log(`CDN URL: ${CDN_URL}`);
        console.log(`Health check: http://localhost:${PORT}/health`);
    });
});

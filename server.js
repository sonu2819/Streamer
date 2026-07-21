const express = require("express");
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

app.options('/movie.mp4', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, RANGE');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Range, Content-Type, Accept, Origin, User-Agent');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

const MOVIE_FILE = path.join(__dirname, "movie.json");

let cachedFileId = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5000;

async function getFileId() {
  const now = Date.now();
  if (cachedFileId && (now - cacheTimestamp) < CACHE_TTL) return cachedFileId;
  try {
    const data = await fs.readFile(MOVIE_FILE, "utf8");
    const { fileId } = JSON.parse(data);
    if (!fileId) throw new Error("fileId missing");
    cachedFileId = fileId;
    cacheTimestamp = now;
    return fileId;
  } catch (err) {
    throw new Error("Unable to read movie config: " + err.message);
  }
}

const API_KEY = process.env.API_KEY || "change_me";
app.post("/update-movie", async (req, res) => {
  const { fileId, apiKey } = req.body;
  if (apiKey !== API_KEY) {
    return res.status(403).json({ success: false, message: "Invalid API key" });
  }
  if (!fileId) {
    return res.status(400).json({ success: false, message: "fileId is required" });
  }
  try {
    await fs.writeFile(MOVIE_FILE, JSON.stringify({ fileId }, null, 2));
    cachedFileId = fileId;
    cacheTimestamp = Date.now();
    res.json({ success: true, message: "Movie updated", fileId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// 🏆 THE FINAL, WORKING STREAM ROUTE (USES PUBLIC DRIVE URL)
// ================================================================
app.get("/movie.mp4", async (req, res) => {
  try {
    const fileId = await getFileId();
    
    // Use the public download URL (this supports range requests)
    const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    
    console.log(`📡 Range header from client: ${req.headers.range || 'None'}`);

    const requestConfig = {
      url: driveUrl,
      method: 'GET',
      responseType: 'stream',
      maxRedirects: 5,
      headers: {},
      validateStatus: (status) => status >= 200 && status < 300,
      timeout: 60000 // 60 seconds timeout
    };

    // Forward the Range header to Google Drive if present
    if (req.headers.range) {
      requestConfig.headers.Range = req.headers.range;
      console.log(`📤 Forwarding Range to Google: ${req.headers.range}`);
    } else {
      // 🔥 Force a range request to get 206 on first load
      requestConfig.headers.Range = 'bytes=0-';
      console.log(`📤 Forcing Range to Google: bytes=0-`);
    }

    const response = await axios(requestConfig);
    console.log(`📥 Google Drive Status: ${response.status}`);

    // --- Set CORS and response headers ---
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Content-Disposition', 'inline; filename="movie.mp4"');

    // Forward headers from Google Drive
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
      console.log(`✅ Google Drive returned Content-Range: ${response.headers['content-range']}`);
    }
    if (response.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
    }

    // Fallback content type
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'video/mp4');
    }

    // Set status code
    const statusCode = response.status;
    res.status(statusCode);
    console.log(`🔥 Sending Status: ${statusCode}`);

    // Pipe the stream
    response.data.pipe(res);

    // Handle client disconnection
    res.on('close', () => {
      console.log('🛑 Client closed connection.');
      response.data.destroy();
    });

    response.data.on('error', (err) => {
      if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
        console.log('🔌 Client disconnected normally.');
      } else {
        console.error('❌ Stream error:', err);
        if (!res.headersSent) {
          res.status(500).send('Error streaming file');
        }
      }
    });

  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    if (!res.headersSent) {
      if (err.response && err.response.status === 404) {
        res.status(404).send('Movie not found');
      } else {
        res.status(500).send('Internal server error');
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running: http://localhost:${PORT}/movie.mp4`);
});
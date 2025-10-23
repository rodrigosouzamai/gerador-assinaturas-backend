// --- SERVIDOR ASSINATURAS GIF — r11 EXTREME TEST (Desenho Mínimo) ---

const express = require('express');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const gifFrames = require('gif-frames');
const GifEncoder = require('gif-encoder-2');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080;
const BUILD = '2025-10-23-r11-EXTREME-TEST'; // Nova versão

const corsOptions = {
  origin: 'https://octopushelpdesk.com.br',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---------- helpers ----------
const streamToBuffer = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });

const pick = (obj, keys, fallback = '') => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) {
      const v = String(obj[k]).trim();
      if (v !== '') return v;
    }
  }
  return fallback;
};

function drawContainNoUpscale(ctx, img, boxX, boxY, boxW, boxH) {
    const imgW = img.width || 1;
    const imgH = img.height || 1;
    if (boxW <= 0 || boxH <= 0 || imgW <= 0 || imgH <= 0) return;
    const s = Math.min(1, Math.min(boxW / imgW, boxH / imgH));
    const dw = Math.round(imgW * s);
    const dh = Math.round(imgH * s);
    const dx = Math.round(boxX + (boxW - dw) / 2);
    const dy = Math.round(boxY + (boxH - dh) / 2);
    try {
      ctx.imageSmoothingEnabled = false;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(img, dx, dy, dw, dh);
    } catch (e) { console.error("[EXTREME] Erro em drawImage:", e.message); }
}

// ---------- Lógica Principal ----------
async function makeSignature(req, res, isTrilha) {
  const body = req.body || {};
  const gifUrl = pick(body, ['gifUrl', 'gif_url', 'gif']);
  const name = pick(body, ['name', 'nome']); // Apenas para log

  // Tamanho Fixo Saída
  const outW = 635;
  const outH = 215;

  if (!gifUrl) return res.status(400).send('Erro: gifUrl é obrigatório.');

  console.log('[REQ EXTREME]', { build: BUILD, trilha: isTrilha, name: name ? name.slice(0,10):'?', gifUrl: gifUrl.slice(0, 50) });

  try {
    // 1. Baixa GIF
    console.log('[EXTREME] Baixando GIF...');
    const r = await fetch(gifUrl);
    if (!r.ok) throw new Error(`Falha ao buscar GIF (${r.status} ${r.statusText})`);
    const gifBuffer = await r.buffer();
    console.log('[EXTREME] GIF baixado.');

    // 2. Extrai Frames (PNG)
    console.log('[EXTREME] Extraindo frames...');
    const frames = await gifFrames({ url: gifBuffer, frames: 'all', outputType: 'png' });
    if (!frames || frames.length === 0) throw new Error('Nenhum frame encontrado no GIF.');
    console.log(`[EXTREME] ${frames.length} frames extraídos.`);

    // 3. Encoder e Resposta
    res.setHeader('Content-Type', 'image/gif');
    const encoder = new GifEncoder(outW, outH, 'neuquant', true);
    encoder.createReadStream().pipe(res);
    encoder.start();
    encoder.setRepeat(0);
    encoder.setQuality(10);

    const canvas = createCanvas(outW, outH);
    const ctx = canvas.getContext('2d');
    console.log('[EXTREME] Canvas e Encoder configurados.');

    // 4. Layout Mínimo
    const padding = 20;
    const leftColW = 240;

    // 5. Processa Frames
    console.log('[EXTREME] Processando frames...');
    let frameCount = 0;
    for (const f of frames) {
      frameCount++;
      const delayMs = (f.frameInfo?.delay ?? 10) * 10;
      encoder.setDelay(delayMs > 10 ? delayMs : 100);

      const frameBuf = await streamToBuffer(f.getImage());
      const frameImg = await loadImage(frameBuf);

      // Limpa e desenha fundo branco
      ctx.clearRect(0, 0, outW, outH);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, outW, outH);

      // Desenha Logo (Frame Original) na esquerda
      drawContainNoUpscale(ctx, frameImg, padding, padding, leftColW - padding * 2, outH - padding * 2);

      // --- TESTE DE DESENHO EXTREMAMENTE SIMPLES ---
      try {
          ctx.fillStyle = '#FF0000'; // Vermelho brilhante
          ctx.font = '40px sans-serif'; // Fonte grande
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          const testX = 300; // Posição X fixa
          const testY = 80;  // Posição Y fixa
          console.log(`[EXTREME Frame ${frameCount}] Desenhando 'TESTE' em ${testX},${testY}`);
          ctx.fillText('TESTE', testX, testY);
      } catch (e) {
          console.error(`[EXTREME Frame ${frameCount}] Erro ao desenhar 'TESTE':`, e.message);
      }
      // --- FIM DO TESTE ---

      encoder.addFrame(ctx);
    }
    console.log(`[EXTREME] ${frameCount} frames processados.`);

    // 6. Finaliza
    console.log('[EXTREME] Finalizando GIF...');
    encoder.finish();
    console.log('[EXTREME] Processamento concluído.');

  } catch (e) {
    console.error('[EXTREME] ERRO GERAL:', e.message, e.stack);
    if (!res.headersSent) {
      res.status(500).send(`Erro interno (EXTREME). Detalhe: ${e.message}`);
    } else {
       console.error('[EXTREME] Erro após início do stream.');
       if (!res.writableEnded) res.end();
    }
  }
}

// ---------- rotas ----------
// Ambas as rotas agora usam a mesma lógica de teste
app.post('/generate-gif-signature', (req, res) => makeSignature(req, res, false));
app.post('/generate-trilha-signature', (req, res) => makeSignature(req, res, true));

// Root (vRAILWAY-EXTREME-TEST)
app.get('/', (_req, res) => res.send(`PROVA: Servidor vRAILWAY-EXTREME-TEST está no ar!`));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT} | build=${BUILD}`);
});


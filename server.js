// --- SERVIDOR ASSINATURAS GIF — r9 FINAL (Canvas Fixo, Layout Maior) ---

const express = require('express');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const gifFrames = require('gif-frames');
const GifEncoder = require('gif-encoder-2');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080; // Railway define a porta via env
const BUILD = '2025-10-23-r9-FINAL'; // Nova versão de build

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

// Desenha imagem dentro da caixa, mantendo proporção, sem aumentar (contain)
function drawContainNoUpscale(ctx, img, boxX, boxY, boxW, boxH) {
  const imgW = img.width || 1;
  const imgH = img.height || 1;
  if (boxW <= 0 || boxH <= 0 || imgW <= 0 || imgH <= 0) return; // Evita erros
  const s = Math.min(1, Math.min(boxW / imgW, boxH / imgH));
  const dw = Math.round(imgW * s);
  const dh = Math.round(imgH * s);
  const dx = Math.round(boxX + (boxW - dw) / 2);
  const dy = Math.round(boxY + (boxH - dh) / 2);

  try {
    const prevEnabled = ctx.imageSmoothingEnabled;
    const prevQual = ctx.imageSmoothingQuality;
    ctx.imageSmoothingEnabled = false; // Sem suavização para GIFs
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.imageSmoothingEnabled = prevEnabled;
    ctx.imageSmoothingQuality = prevQual || 'high';
  } catch (e) {
      console.error("Erro em drawImage:", e.message);
  }
}

// Desenha texto com wrap + stroke para visibilidade
function drawTextSafe(ctx, text, x, y, maxW, lineH) {
  if (!text || maxW <= 0) return y;
  text = String(text); // Garante que é string

  try {
    const words = text.split(/\s+/);
    let line = '';
    let currentY = y;
    for (let i = 0; i < words.length; i++) {
      const test = line ? `${line} ${words[i]}` : words[i];
      // Verifica se o texto excede a largura
      if (ctx.measureText(test).width > maxW && i > 0) {
        ctx.strokeText(line, x, currentY); // Desenha stroke primeiro
        ctx.fillText(line, x, currentY);   // Desenha fill por cima
        line = words[i];
        currentY += lineH;
      } else {
        line = test;
      }
    }
    // Desenha a última linha
    ctx.strokeText(line, x, currentY);
    ctx.fillText(line, x, currentY);
    return currentY; // Retorna Y da linha base da última linha desenhada
  } catch (e) {
    console.error("Erro em drawTextSafe:", e.message, "Texto:", text);
    return y; // Retorna Y original em caso de erro
  }
}

// ---------- Lógica Principal ----------
async function makeSignature(req, res, isTrilha) {
  const body = req.body || {};

  // Extrai dados
  const name   = pick(body, ['name', 'nome'], 'Seu Nome');
  const title  = pick(body, ['title', 'cargo'], 'Seu Cargo');
  const phone  = pick(body, ['phone', 'telefone'], 'Seu Telefone');
  const gifUrl = pick(body, ['gifUrl', 'gif_url', 'gif']);
  const department = pick(body, ['department', 'departamento'], '');
  const address = pick(
    body, ['address', 'endereco', 'endereço'],
    'Setor SRPN - Estadio Mané Garrincha Raio 46/47 Cep: 70070-701 - Camarote Vip 09. Brasilia - DF. Brasil'
  );
  const email = pick(body, ['email', 'e-mail'], '');
  const qrCodeData = body.qrCodeData;

  // Tamanho de Saída Fixo (como era na versão r8)
  const outW = 635;
  const outH = 215;

  // Validações
  if (!gifUrl || !name || !title || !phone) {
    return res.status(400).send('Erro: envie name, title, phone e gifUrl.');
  }
  if (isTrilha && !qrCodeData) {
    return res.status(400).send('Erro: qrCodeData é obrigatório para Trilha.');
  }

  const short = (s) => (s ? String(s).slice(0, 80) : s);
  console.log('[REQ]', { build: BUILD, trilha: isTrilha, name: short(name), gifUrl: short(gifUrl) });

  try {
    // 1. Baixa GIF
    const r = await fetch(gifUrl);
    if (!r.ok) throw new Error(`Falha ao buscar GIF (${r.status} ${r.statusText})`);
    const gifBuffer = await r.buffer();

    // 2. Extrai Frames (como PNG)
    const frames = await gifFrames({ url: gifBuffer, frames: 'all', outputType: 'png' });
    if (!frames || frames.length === 0) throw new Error('Nenhum frame encontrado no GIF.');

    // 3. Configura Encoder e Resposta
    res.setHeader('Content-Type', 'image/gif');
    const encoder = new GifEncoder(outW, outH, 'neuquant', true); // Usa tamanho fixo
    encoder.createReadStream().pipe(res);
    encoder.start();
    encoder.setRepeat(0);
    encoder.setQuality(10); // Qualidade ajustada

    const canvas = createCanvas(outW, outH); // Usa tamanho fixo
    const ctx = canvas.getContext('2d');

    // 4. Layout Fixo (Ajustado para 635x215)
    const padding = 20; // Maior padding
    const leftColW = 240; // Largura maior para logo
    const dividerX = leftColW;
    const textLeft = dividerX + 20; // Espaço maior após divisor
    let textAreaRight = outW - padding;

    // Fontes Maiores (Fixas)
    const nameSize  = 22;
    const subSize   = 18;
    const boldSub   = 18;
    const lineH     = 25; // Espaço maior entre linhas
    const smallSize = 14;
    const smallLH   = 18;

    // Cores e Stroke
    const nameColor   = isTrilha ? '#0E2923' : '#003366';
    const normalColor = isTrilha ? '#0E2923' : '#555555';
    const subtleColor = '#777777';
    const strokeStyle = 'rgba(0,0,0,0.1)'; // Stroke bem sutil
    const setupStroke = () => { ctx.lineWidth = 0.4; ctx.strokeStyle = strokeStyle; };

    // QR Code (Trilha)
    let qrImage = null;
    let qrSize = 0, qrX = 0, qrY = 0;
    if (isTrilha && qrCodeData) {
      try {
        qrImage = await loadImage(qrCodeData);
        qrSize = Math.min(outH * 0.75, 130); // QR adaptado à altura, max 130px
        qrSize = Math.max(80, qrSize);     // Mínimo 80px
        qrX = outW - padding - qrSize;
        qrY = (outH - qrSize) / 2;         // Centraliza verticalmente
        textAreaRight = qrX - 20;          // Ajusta limite direito do texto
      } catch(e) { console.error("Erro ao carregar QR Code:", e.message); }
    }

    const maxTextWidth = Math.max(50, textAreaRight - textLeft); // Largura máxima do texto

    // 5. Processa cada Frame
    for (const f of frames) {
      const delayMs = (f.frameInfo?.delay ?? 10) * 10;
      encoder.setDelay(delayMs > 10 ? delayMs : 100);

      const frameBuf = await streamToBuffer(f.getImage());
      const frameImg = await loadImage(frameBuf);

      // Limpa e desenha fundo (branco)
      ctx.clearRect(0, 0, outW, outH);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, outW, outH);

      // Desenha Logo (Frame do GIF original) na área esquerda
      drawContainNoUpscale(ctx, frameImg, padding, padding, leftColW - padding * 2, outH - padding * 2);

      // Divisor Vertical (se não for Trilha)
      if (!isTrilha) {
        ctx.fillStyle = '#005A9C'; // Cor do divisor
        ctx.fillRect(dividerX, padding, 2, outH - padding * 2);
      }

      // Desenha QR (se Trilha)
      if (isTrilha && qrImage) {
        ctx.fillStyle = '#FFFFFF'; // Fundo branco atrás do QR
        ctx.fillRect(qrX - 5, qrY - 5, qrSize + 10, qrSize + 10);
        ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
      }

      // Desenha Textos
      let currentY = padding + 10; // Começa um pouco abaixo do topo
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';

      // Nome
      ctx.fillStyle = nameColor;
      ctx.font = `bold ${nameSize}px sans-serif`;
      setupStroke();
      // Ajuste para drawTextSafe retornar a posição Y da linha BASE do texto desenhado
      let lastY = drawTextSafe(ctx, name, textLeft, currentY, maxTextWidth, lineH);
      currentY = lastY + lineH + 6; // Próxima linha = Y da linha base + altura da linha + espaço

      // Departamento (se houver e não for Trilha)
      if (department && !isTrilha) {
        ctx.fillStyle = normalColor;
        ctx.font = `${subSize}px sans-serif`;
        setupStroke();
        lastY = drawTextSafe(ctx, department, textLeft, currentY, maxTextWidth, lineH);
        currentY = lastY + lineH; // Próxima linha
      }

      // Cargo
      ctx.fillStyle = normalColor;
      ctx.font = `${subSize}px sans-serif`;
      setupStroke();
      lastY = drawTextSafe(ctx, title, textLeft, currentY, maxTextWidth, lineH);
      currentY = lastY + lineH; // Próxima linha

      // Telefone
      ctx.fillStyle = normalColor;
      ctx.font = `bold ${boldSub}px sans-serif`;
      setupStroke();
      lastY = drawTextSafe(ctx, phone, textLeft, currentY + 3, maxTextWidth, lineH); // Adiciona espaço antes
      currentY = lastY + lineH; // Próxima linha

      // Email (se houver)
      if (email) {
        ctx.fillStyle = normalColor;
        ctx.font = `${subSize}px sans-serif`;
        setupStroke();
        lastY = drawTextSafe(ctx, email, textLeft, currentY + 3, maxTextWidth, lineH); // Adiciona espaço antes
        currentY = lastY + lineH; // Próxima linha
      }

      // Endereço (se houver e não for Trilha)
      if (address && !isTrilha) {
        ctx.fillStyle = subtleColor;
        ctx.font = `${smallSize}px sans-serif`;
        setupStroke();
        // Desenha no espaço restante
        drawTextSafe(ctx, address, textLeft, currentY + 8, maxTextWidth, smallLH);
      }

      // Adiciona frame ao encoder
      encoder.addFrame(ctx);
    }

    // 6. Finaliza
    encoder.finish();
    console.log('[ASSINATURA] OK', BUILD);
  } catch (e) {
    console.error('[ASSINATURA] ERRO:', e.message, e.stack);
    if (!res.headersSent) {
      res.status(500).send(`Erro interno ao processar o GIF. Detalhe: ${e.message}`);
    } else {
       console.error('Erro após início do stream; resposta pode estar incompleta.');
       if (!res.writableEnded) res.end(); // Força o fechamento
    }
  }
}

// ---------- rotas ----------
app.post('/generate-gif-signature', (req, res) => makeSignature(req, res, false));
app.post('/generate-trilha-signature', (req, res) => makeSignature(req, res, true));

app.get('/version', (_req, res) => res.json({ build: BUILD }));
// Root (vRAILWAY-LAYOUT-R9) - Nova versão para prova
app.get('/', (_req, res) => res.send(`PROVA: Servidor vRAILWAY-LAYOUT-R9 está no ar!`));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT} | build=${BUILD}`);
});


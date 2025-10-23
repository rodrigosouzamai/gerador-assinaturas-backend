// --- SERVIDOR ASSINATURAS GIF — r8.1 (Layout Corrigido) ---

const express = require('express');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const gifFrames = require('gif-frames');
const GifEncoder = require('gif-encoder-2');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080; // Railway define a porta via env
const BUILD = '2025-10-23-r8.1';

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

// Pega o primeiro valor não vazio de uma lista de chaves num objeto
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
  const imgW = img.width || 1; // Evita divisão por zero
  const imgH = img.height || 1;
  const s = Math.min(1, Math.min(boxW / imgW, boxH / imgH)); // Escala <= 1
  const dw = Math.round(imgW * s);
  const dh = Math.round(imgH * s);
  const dx = Math.round(boxX + (boxW - dw) / 2);
  const dy = Math.round(boxY + (boxH - dh) / 2);

  // Desativa suavização para GIFs não ficarem borrados
  const prevEnabled = ctx.imageSmoothingEnabled;
  const prevQual = ctx.imageSmoothingQuality;
  ctx.imageSmoothingEnabled = false;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.imageSmoothingEnabled = prevEnabled;
  ctx.imageSmoothingQuality = prevQual || 'high';
}

// Desenha texto com wrap + fallback; usa fill e stroke para garantir visibilidade
// Retorna a posição Y final
function drawTextSafe(ctx, text, x, y, maxW, lineH) {
  if (!text || maxW <= 0) return y; // Não desenha se não houver texto ou espaço

  const tryWrap = () => {
    const words = String(text).split(/\s+/);
    let line = '';
    let currentY = y;
    for (let i = 0; i < words.length; i++) {
      const test = line ? `${line} ${words[i]}` : words[i];
      // Verifica se o texto de teste excede a largura máxima
      if (ctx.measureText(test).width > maxW && i > 0) {
        ctx.fillText(line, x, currentY);
        ctx.strokeText(line, x, currentY); // contorno fino
        line = words[i]; // Começa nova linha com a palavra atual
        currentY += lineH; // Move para a próxima linha
      } else {
        line = test; // Continua na mesma linha
      }
    }
    // Desenha a última linha (ou única linha)
    ctx.fillText(line, x, currentY);
    ctx.strokeText(line, x, currentY);
    return currentY; // Retorna a posição Y da última linha desenhada
  };

  // Se a medição falhar ou der largura ~0, desenha sem wrap como fallback
  try {
      const m = ctx.measureText(String(text));
      if (!m || !m.width || m.width < 0.1) {
        ctx.fillText(String(text), x, y);
        ctx.strokeText(String(text), x, y);
        return y;
      }
      return tryWrap();
  } catch(e) {
      console.error("Erro em measureText/fillText:", e.message, "Texto:", text);
      // Fallback muito simples se fillText falhar
      try { ctx.fillText('?', x, y); } catch {}
      return y;
  }
}

// ---------- Lógica Principal ----------
async function makeSignature(req, res, isTrilha) {
  const body = req.body || {};

  // Extrai dados do payload
  const name   = pick(body, ['name', 'nome'], 'Seu Nome');
  const title  = pick(body, ['title', 'cargo'], 'Seu Cargo');
  const phone  = pick(body, ['phone', 'telefone'], 'Seu Telefone');
  const gifUrl = pick(body, ['gifUrl', 'gif_url', 'gif']);
  const department = pick(body, ['department', 'departamento'], ''); // Pega departamento se enviado
  const address = pick(
    body,
    ['address', 'endereco', 'endereço'],
    'Setor SRPN - Estadio Mané Garrincha Raio 46/47 Cep: 70070-701 - Camarote Vip 09. Brasilia - DF. Brasil'
  );
  const email = pick(body, ['email', 'e-mail'], ''); // Pega email se enviado
  const qrCodeData = body.qrCodeData; // Para Trilha

  // Validações básicas
  if (!gifUrl || !name || !title || !phone) {
    return res.status(400).send('Erro: envie name, title, phone e gifUrl.');
  }
  if (isTrilha && !qrCodeData) {
    return res.status(400).send('Erro: qrCodeData é obrigatório para Trilha.');
  }

  const short = (s) => (s ? String(s).slice(0, 80) : s);
  console.log('[REQ]', { build: BUILD, trilha: isTrilha, name: short(name), title: short(title), gifUrl: short(gifUrl) });

  try {
    // 1. Baixa GIF
    const r = await fetch(gifUrl);
    if (!r.ok) throw new Error(`Falha ao buscar GIF (${r.status} ${r.statusText})`);
    const gifBuffer = await r.buffer();

    // 2. Extrai Frames (como PNG)
    const frames = await gifFrames({ url: gifBuffer, frames: 'all', outputType: 'png' });
    if (!frames || frames.length === 0) throw new Error('Nenhum frame encontrado no GIF.');

    // 3. Determina Dimensões Reais
    const firstBuf = await streamToBuffer(frames[0].getImage());
    const firstImg = await loadImage(firstBuf);
    const width = firstImg.width;   // <-- USA LARGURA REAL
    const height = firstImg.height; // <-- USA ALTURA REAL
    if (width <= 0 || height <= 0) throw new Error('Dimensões inválidas do GIF.');
    console.log(`[ASSINATURA] Dimensões reais: ${width}x${height}`);

    // 4. Configura Encoder e Resposta
    res.setHeader('Content-Type', 'image/gif');
    const encoder = new GifEncoder(width, height, 'neuquant', true); // <-- Usa dimensões reais
    encoder.createReadStream().pipe(res);
    encoder.start();
    encoder.setRepeat(0);
    encoder.setQuality(10); // Qualidade ajustada (1-30)

    const canvas = createCanvas(width, height); // <-- Usa dimensões reais
    const ctx = canvas.getContext('2d');

    // 5. Layout Adaptativo (Calculado com base em width/height reais)
    const padding = Math.max(10, Math.min(20, width * 0.03)); // Padding proporcional
    const leftColW = width * 0.40; // Logo ocupa 40%
    const dividerX = leftColW;
    const textLeft = dividerX + Math.max(10, width * 0.02); // Espaço após divisor
    let textAreaRight = width - padding; // Limite direito base

    // Fontes Adaptativas (baseado na altura)
    const nameSize  = Math.max(14, Math.min(20, height * 0.08)); // Nome ~8% da altura
    const subSize   = Math.max(11, Math.min(16, height * 0.065)); // Subtexto ~6.5%
    const boldSub   = subSize;
    const lineH     = subSize * 1.4; // Espaço entre linhas
    const smallSize = Math.max(9, Math.min(12, height * 0.05)); // Endereço ~5%
    const smallLH   = smallSize * 1.3;

    // Cores e Stroke
    const nameColor   = isTrilha ? '#0E2923' : '#003366';
    const normalColor = isTrilha ? '#0E2923' : '#555555';
    const subtleColor = '#777777';
    const strokeStyle = 'rgba(0,0,0,0.15)'; // Stroke mais sutil
    const setupStroke = () => { ctx.lineWidth = 0.5; ctx.strokeStyle = strokeStyle; };

    // QR Code (Trilha)
    let qrImage = null;
    let qrSize = 0, qrX = 0, qrY = 0;
    if (isTrilha && qrCodeData) {
      try {
        qrImage = await loadImage(qrCodeData);
        qrSize = Math.min(height * 0.8, width * 0.25, 110); // QR adaptativo, max 110px
        qrSize = Math.max(50, qrSize); // Mínimo 50px
        qrX = width - padding - qrSize;
        qrY = (height - qrSize) / 2; // Centraliza verticalmente
        textAreaRight = qrX - Math.max(10, width * 0.02); // Ajusta limite direito do texto
      } catch(e) {
        console.error("Erro ao carregar QR Code:", e.message);
        // Continua sem QR code se falhar
      }
    }

    const maxTextWidth = Math.max(40, textAreaRight - textLeft); // Largura máxima do texto

    // 6. Processa cada Frame
    for (const f of frames) {
      const delayMs = (f.frameInfo?.delay ?? 10) * 10;
      encoder.setDelay(delayMs > 10 ? delayMs : 100);

      const frameBuf = await streamToBuffer(f.getImage());
      const frameImg = await loadImage(frameBuf);

      // Limpa e desenha fundo (branco) e frame do GIF
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#FFFFFF'; // Garante fundo branco se GIF for transparente
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(frameImg, 0, 0, width, height); // Desenha frame original

      // Desenha Logo (na área esquerda)
      // drawContainNoUpscale(ctx, frameImg, padding, padding, leftColW - padding * 2, height - padding * 2);
      // O frame já é o logo nesta versão

      // Divisor Vertical (se não for Trilha)
      if (!isTrilha) {
        ctx.fillStyle = '#005A9C'; // Cor do divisor
        ctx.fillRect(dividerX, padding, 2, height - padding * 2);
      }

      // Desenha QR (se Trilha)
      if (isTrilha && qrImage) {
        // Fundo branco atrás do QR
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8);
        ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
      }

      // Desenha Textos
      let currentY = padding + 5; // Começa perto do topo
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';

      // Nome
      ctx.fillStyle = nameColor;
      ctx.font = `bold ${nameSize}px sans-serif`;
      setupStroke();
      currentY = drawTextSafe(ctx, name, textLeft, currentY, maxTextWidth, lineH) + Math.max(4, height*0.015); // Espaço pós-nome

      // Departamento (se houver e não for Trilha)
      if (department && !isTrilha) {
        ctx.fillStyle = normalColor;
        ctx.font = `${subSize}px sans-serif`;
        setupStroke();
        currentY = drawTextSafe(ctx, department, textLeft, currentY, maxTextWidth, lineH);
      }

      // Cargo
      ctx.fillStyle = normalColor;
      ctx.font = `${subSize}px sans-serif`;
      setupStroke();
      currentY = drawTextSafe(ctx, title, textLeft, currentY, maxTextWidth, lineH);

      // Telefone
      ctx.fillStyle = normalColor;
      ctx.font = `bold ${boldSub}px sans-serif`;
      setupStroke();
      currentY = drawTextSafe(ctx, phone, textLeft, currentY + Math.max(2, height*0.005), maxTextWidth, lineH);

      // Email (se houver)
      if (email) {
        ctx.fillStyle = normalColor;
        ctx.font = `${subSize}px sans-serif`;
        setupStroke();
        currentY = drawTextSafe(ctx, email, textLeft, currentY + Math.max(2, height*0.005), maxTextWidth, lineH);
      }

      // Endereço (se houver e não for Trilha)
      if (address && !isTrilha) {
        ctx.fillStyle = subtleColor;
        ctx.font = `${smallSize}px sans-serif`;
        setupStroke();
        drawTextSafe(ctx, address, textLeft, currentY + Math.max(6, height*0.02), maxTextWidth, smallLH);
      }

      // Adiciona frame ao encoder
      encoder.addFrame(ctx);
    }

    // 7. Finaliza
    encoder.finish();
    console.log('[ASSINATURA] OK', BUILD);
  } catch (e) {
    console.error('[ASSINATURA] ERRO:', e.message, e.stack);
    if (!res.headersSent) {
      res.status(500).send(`Erro interno ao processar o GIF. Detalhe: ${e.message}`);
    } else {
       console.error('Erro após início do stream; resposta pode estar incompleta.');
        // Tenta fechar o stream se ainda estiver aberto
       if (!res.writableEnded) {
           res.end(); // Força o fechamento
       }
    }
  }
}

// ---------- rotas ----------
app.post('/generate-gif-signature', (req, res) => makeSignature(req, res, false));
app.post('/generate-trilha-signature', (req, res) => makeSignature(req, res, true));

app.get('/version', (_req, res) => res.json({ build: BUILD }));
// Root (vRAILWAY-LAYOUT-R8.1) - Nova versão para prova
app.get('/', (_req, res) => res.send(`PROVA: Servidor vRAILWAY-LAYOUT-R8.1 está no ar!`));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT} | build=${BUILD}`);
});


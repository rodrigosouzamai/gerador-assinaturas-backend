// --- SERVIDOR NODE.JS PARA GERAÇÃO DE ASSINATURAS (RAILWAY/RENDER - LAYOUT REFINADO) ---

const express = require('express');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const gifFrames = require('gif-frames');
const GifEncoder = require('gif-encoder-2');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   C O R S   R E S T R I T O
   ========================= */
const corsOptions = {
  origin: 'https://octopushelpdesk.com.br', // ajuste se precisar liberar outro domínio
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* ============================================
   H E L P E R S
   ============================================ */

// Converte um stream (gif-frames em PNG) para Buffer
const streamToBuffer = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });

/* ============================================
   L Ó G I C A   D E   G E R A Ç Ã O   D E   G I F
   ============================================ */

const handleGifGeneration = async (req, res, isTrilha = false) => {
  const { name, title, phone, gifUrl, qrCodeData } = req.body;

  // Validações
  if (!gifUrl || !name || !title || !phone) {
    return res.status(400).send('Erro: faltam parâmetros obrigatórios (nome, cargo, telefone, gifUrl).');
  }
  if (isTrilha && !qrCodeData) {
    return res.status(400).send('Erro: QR Code é obrigatório para a assinatura da Trilha.');
  }

  try {
    console.log(`[ASSINATURA] Início | empresa=${isTrilha ? 'Trilha' : 'Outra'} | nome=${name}`);

    // 1) Baixa o GIF de origem
    const gifResp = await fetch(gifUrl);
    if (!gifResp.ok) {
      throw new Error(`Falha ao buscar GIF (${gifResp.status} ${gifResp.statusText})`);
    }
    const gifBuffer = await gifResp.buffer();

    // 2) Extrai frames como PNG (evita DOM/document)
    const frames = await gifFrames({
      url: gifBuffer,
      frames: 'all',
      outputType: 'png'
    });

    if (!frames || frames.length === 0) {
      throw new Error('Nenhum frame encontrado no GIF.');
    }

    // 3) Dimensões a partir do primeiro frame (PNG)
    const firstBuf = await streamToBuffer(frames[0].getImage());
    const firstImg = await loadImage(firstBuf);
    const width = firstImg.width;
    const height = firstImg.height;
    console.log(`[ASSINATURA] Dimensões detectadas: ${width}x${height}`);

    // 4) Configura encoder e resposta (stream)
    res.setHeader('Content-Type', 'image/gif');
    const encoder = new GifEncoder(width, height, 'neuquant', true);
    encoder.createReadStream().pipe(res);

    encoder.start();
    encoder.setRepeat(0);   // loop infinito
    encoder.setQuality(10); // 1 (melhor) a 30 (pior)

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 5) Pré-carrega QR (se Trilha)
    let qrImage = null;
    if (isTrilha) {
      try {
        qrImage = await loadImage(qrCodeData);
      } catch (e) {
        throw new Error('Falha ao carregar QR Code (qrCodeData inválido?).');
      }
    }

    // --- Constantes de Layout REFINADAS ---
    const qrWidth = Math.min(110, width * 0.25); // QR code com no max 25% da largura
    const qrHeight = qrWidth;
    const qrMarginRight = 10;
    const qrMarginTop = 5;
    const qrX = width - qrWidth - qrMarginRight;
    const qrY = (height - qrHeight) / 2 > qrMarginTop ? (height - qrHeight) / 2 : qrMarginTop;

    // Área estimada do logo (esquerda) - Ajuste conforme necessário
    const logoAreaWidth = width * 0.38; // Logo ocupa ~38% da largura

    // Área para texto
    const textStartX = logoAreaWidth + 15; // Começa após o logo + margem maior
    let textEndX = width - 15; // Termina antes da borda direita com margem
    if (isTrilha) {
        textEndX = qrX - 15; // Termina antes do QR + margem
    }
    const textAvailableWidth = textEndX - textStartX;

    // 6) Processa frames
    for (const f of frames) {
      const delayMs = (f.frameInfo?.delay ?? 10) * 10; // fallback seguro
      encoder.setDelay(delayMs > 10 ? delayMs : 100); // Garante delay mínimo

      // Converte o frame (stream PNG) para imagem de canvas
      const frameBuf = await streamToBuffer(f.getImage());
      const frameImg = await loadImage(frameBuf);

      // Desenha base
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(frameImg, 0, 0, width, height);

      // --- DESENHO COM LAYOUT REFINADO ---
      if (isTrilha) {
        // Desenha QR
        if (qrImage) {
          ctx.drawImage(qrImage, qrX, qrY, qrWidth, qrHeight);
        }
        // Textos (Trilha) - Fontes Maiores, Centralização Vertical
        ctx.fillStyle = '#0E2923'; // Cor escura para Trilha
        const trilhaBaseFontSize = Math.max(14, Math.min(18, height * 0.15)); // Fonte base maior
        const trilhaLineSpacing = trilhaBaseFontSize * 0.4;
        const trilhaNameFontSize = trilhaBaseFontSize + 4;
        const trilhaTextBlockHeight = (trilhaNameFontSize + trilhaLineSpacing + trilhaBaseFontSize + trilhaLineSpacing + trilhaBaseFontSize);
        let trilhaCurrentY = (height - trilhaTextBlockHeight) / 2 + trilhaNameFontSize;
        if (trilhaCurrentY < trilhaNameFontSize + 5) trilhaCurrentY = trilhaNameFontSize + 5; // Margem topo

        ctx.font = `bold ${trilhaNameFontSize}px sans-serif`;
        ctx.fillText(name, textStartX, trilhaCurrentY, textAvailableWidth);

        trilhaCurrentY += trilhaBaseFontSize + trilhaLineSpacing;
        ctx.font = `${trilhaBaseFontSize}px sans-serif`;
        ctx.fillText(title, textStartX, trilhaCurrentY, textAvailableWidth);

        trilhaCurrentY += trilhaBaseFontSize + trilhaLineSpacing;
        ctx.font = `bold ${trilhaBaseFontSize}px sans-serif`;
        ctx.fillText(phone, textStartX, trilhaCurrentY, textAvailableWidth);

      } else {
        // Textos padrão (outras empresas) - Fonte Maior, Branco Padrão
        ctx.fillStyle = '#FFFFFF'; // Branco como padrão - ALTERAR SE NECESSÁRIO PARA FUNDOS CLAROS
        const baseFontSize = Math.max(13, Math.min(16, height * 0.12)); // Fonte base maior
        const lineSpacing = baseFontSize * 0.35;
        const nameFontSize = baseFontSize + 2;
        const textBlockHeight = (nameFontSize + lineSpacing + baseFontSize + lineSpacing + baseFontSize);
        let currentY = (height - textBlockHeight) / 2 + nameFontSize;
        if (currentY < nameFontSize + 5) currentY = nameFontSize + 5; // Margem topo

        ctx.font = `bold ${nameFontSize}px sans-serif`;
        ctx.fillText(name, textStartX, currentY, textAvailableWidth);

        currentY += baseFontSize + lineSpacing;
        ctx.font = `${baseFontSize}px sans-serif`;
        ctx.fillText(title, textStartX, currentY, textAvailableWidth);

        currentY += baseFontSize + lineSpacing;
        ctx.font = `${baseFontSize}px sans-serif`;
        ctx.fillText(phone, textStartX, currentY, textAvailableWidth);
      }
      // --- FIM DESENHO COM LAYOUT REFINADO ---

      // Adiciona frame
      encoder.addFrame(ctx);
    }

    // 7) Finaliza
    encoder.finish();
    console.log('[ASSINATURA] Concluído com sucesso.');
  } catch (error) {
    console.error('[ASSINATURA] ERRO:', error);
    if (!res.headersSent) {
      res.status(500).send(`Erro interno crítico no servidor ao processar o GIF. Detalhe: ${error.message}`);
    } else {
      console.error('Erro após início do stream; resposta pode estar incompleta.');
    }
  }
};

/* ============================================
   R O T A S
   ============================================ */

// Rotas principais usadas pelo front (sem prefixo)
app.post('/generate-gif-signature', (req, res) => handleGifGeneration(req, res, false));
app.post('/generate-trilha-signature', (req, res) => handleGifGeneration(req, res, true));

// Healthcheck simples
app.get('/test-connection', (_req, res) => res.json({ status: 'ok', message: 'Backend operacional.' }));

// Root (vRAILWAY-LAYOUTREFINED)
app.get('/', (_req, res) => res.send('PROVA: Servidor vRAILWAY-LAYOUTREFINED está no ar!'));

/* ============================================
   S U B I N D O   S E R V I D O R
   ============================================ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});


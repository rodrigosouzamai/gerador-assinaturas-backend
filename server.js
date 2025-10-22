// --- SERVIDOR NODE.JS PARA GERAÇÃO DE ASSINATURAS ANIMADAS (vMemOpt) ---

// Importa as bibliotecas necessárias
const express = require('express');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const getFrames = require('gif-frames');
const GifEncoder = require('gif-encoder-2');
const cors = require('cors');
const fetch = require('node-fetch');

// Configuração básica do servidor
const app = express();
const PORT = process.env.PORT || 3000;

const corsOptions = {
  origin: 'https://octopushelpdesk.com.br',
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const handleGifGeneration = async (req, res, isTrilha = false) => {
    const { name, title, phone, gifUrl, qrCodeData } = req.body;

    if (!gifUrl || !name || !title || !phone) {
        return res.status(400).send('Faltam parâmetros obrigatórios.');
    }
    if (isTrilha && !qrCodeData) {
        return res.status(400).send('QR Code é obrigatório para Trilha.');
    }

    try {
        const gifBufferResponse = await fetch(gifUrl);
        if (!gifBufferResponse.ok) throw new Error(`Falha ao buscar GIF: ${gifBufferResponse.statusText}`);
        const gifBuffer = await gifBufferResponse.buffer();

        const frameData = await getFrames({ url: gifBuffer, frames: 'all', outputType: 'canvas', napiCanvas: true });
        
        const { width, height } = frameData[0].getImage();
        
        // --- Otimização de Memória: Usando Stream ---
        res.setHeader('Content-Type', 'image/gif');
        const encoder = new GifEncoder(width, height, 'neuquant', true);
        
        // Pipe a saída do encoder diretamente para a resposta da requisição
        encoder.createReadStream().pipe(res);

        encoder.start();
        encoder.setRepeat(0);
        encoder.setQuality(10);

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        let qrImage = null;
        if (isTrilha) {
             qrImage = await loadImage(qrCodeData);
        }

        for (const frame of frameData) {
            const frameDelay = frame.frameInfo.delay * 10;
            encoder.setDelay(frameDelay);

            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(frame.getImage(), 0, 0, width, height);
            
            if (isTrilha) {
                ctx.drawImage(qrImage, 330, 10, 110, 110); 
                ctx.fillStyle = '#0E2923';
                ctx.font = 'bold 18px sans-serif';
                ctx.fillText(name, 160, 50);
                ctx.font = '14px sans-serif';
                ctx.fillText(title, 160, 70);
                ctx.font = 'bold 14px sans-serif';
                ctx.fillText(phone, 160, 90);
            } else {
                ctx.fillStyle = '#FFFFFF';
                if(gifUrl.includes("netflix")) {
                     ctx.fillStyle = '#000000';
                }
                ctx.font = 'bold 16px sans-serif';
                ctx.fillText(name, 170, 45);
                ctx.font = '13px sans-serif';
                ctx.fillText(title, 170, 65);
                ctx.fillText(phone, 170, 85);
            }
            encoder.addFrame(ctx);
        }

        encoder.finish();

    } catch (error) {
        console.error("ERRO GERAL NO PROCESSAMENTO:", error);
        if (!res.headersSent) {
             res.status(500).send(`Falha ao processar o GIF. Detalhe: ${error.message}`);
        }
    }
};

app.post('/gerador-api/generate-gif-signature', (req, res) => {
    handleGifGeneration(req, res, false);
});

app.post('/gerador-api/generate-trilha-signature', (req, res) => {
    handleGifGeneration(req, res, true);
});

app.get('/gerador-api/', (req, res) => {
    res.send('Servidor do gerador de assinaturas (vMemOpt) está no ar!');
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});


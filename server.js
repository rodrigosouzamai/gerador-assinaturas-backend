// --- SERVIDOR NODE.JS PARA GERAÇÃO DE ASSINATURAS (OTIMIZADO PARA RAILWAY/RENDER - CORREÇÃO CORS) ---

const express = require('express');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const getFrames = require('gif-frames');
const GifEncoder = require('gif-encoder-2');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CORREÇÃO CORS ---
// Configuração explícita para permitir SOMENTE o seu domínio do WordPress
// e lidar corretamente com as requisições preflight (OPTIONS)
const corsOptions = {
  origin: 'https://octopushelpdesk.com.br', // Permite apenas este domínio
  methods: ['GET', 'POST', 'OPTIONS'],    // Permite estes métodos HTTP
  allowedHeaders: ['Content-Type'],       // Permite este cabeçalho
  optionsSuccessStatus: 200               // Responde OK para preflight
};
app.use(cors(corsOptions));
// Garante que as requisições OPTIONS sejam respondidas corretamente
app.options('*', cors(corsOptions));
// --- FIM DA CORREÇÃO CORS ---

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Função unificada para gerar GIFs
const handleGifGeneration = async (req, res, isTrilha = false) => {
    const { name, title, phone, gifUrl, qrCodeData } = req.body;

    // Etapa 1: Validação
    if (!gifUrl || !name || !title || !phone) {
        return res.status(400).send('Erro de Diagnóstico: Faltam parâmetros obrigatórios.');
    }
    if (isTrilha && !qrCodeData) {
        return res.status(400).send('Erro de Diagnóstico: QR Code é obrigatório para a assinatura da Trilha.');
    }

    try {
        // Etapa 2: Buscar o GIF
        const gifBufferResponse = await fetch(gifUrl);
        if (!gifBufferResponse.ok) throw new Error(`Falha ao buscar o GIF. Status: ${gifBufferResponse.statusText}`);
        const gifBuffer = await gifBufferResponse.buffer();

        // Etapa 3: Decodificar os frames do GIF
        const frameData = await getFrames({ url: gifBuffer, frames: 'all', outputType: 'canvas', napiCanvas: true });

        const { width, height } = frameData[0].getImage();

        res.setHeader('Content-Type', 'image/gif');
        const encoder = new GifEncoder(width, height, 'neuquant', true);

        encoder.createReadStream().pipe(res);
        encoder.start();
        encoder.setRepeat(0);
        encoder.setQuality(10);

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        let qrImage = null;
        if (isTrilha) {
             // Etapa 4: Carregar imagem do QR Code (se aplicável)
             qrImage = await loadImage(qrCodeData);
        }

        // Etapa 5: Processar e editar cada frame
        for (const frame of frameData) {
            const frameDelay = frame.frameInfo.delay * 10;
            encoder.setDelay(frameDelay);

            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(frame.getImage(), 0, 0, width, height);

            if (isTrilha) {
                // Posicionamento e estilo para Trilha
                ctx.drawImage(qrImage, width - 120, 5, 110, 110); // Ajustado para canto direito
                ctx.fillStyle = '#0E2923'; // Cor do texto Trilha
                ctx.font = 'bold 18px sans-serif';
                ctx.fillText(name, 160, 50);
                ctx.font = '14px sans-serif';
                ctx.fillText(title, 160, 70);
                ctx.font = 'bold 14px sans-serif';
                ctx.fillText(phone, 160, 90);
            } else {
                 // Posicionamento e estilo para outras empresas
                let textColor = '#FFFFFF'; // Cor padrão
                // Define cores específicas se necessário
                if(gifUrl.includes("netflix")) { textColor = '#E50914'; }
                if(gifUrl.includes("pinterest")) { textColor = '#E60023'; }
                // Adicione outras cores aqui se precisar
                // if(gifUrl.includes("voicer")) { textColor = '#XXXXXX'; }

                ctx.fillStyle = textColor;
                ctx.font = 'bold 16px sans-serif';
                ctx.fillText(name, 170, 45); // Posição padrão
                ctx.font = '13px sans-serif';
                ctx.fillText(title, 170, 65);
                ctx.fillText(phone, 170, 85);
            }
            encoder.addFrame(ctx);
        }

        // Etapa 6: Finalizar a codificação do novo GIF
        encoder.finish();

    } catch (error) {
        // Etapa de Erro: Captura e envia o erro detalhado
        console.error("ERRO DETALHADO NO PROCESSAMENTO:", error);
        if (!res.headersSent) {
             // Envia uma resposta de erro clara para o frontend
             res.status(500).send(`Erro interno no servidor ao processar o GIF. Detalhe: ${error.message}`);
        }
    }
};

// --- ROTAS DA API ---

// Rota para GIFs genéricos
app.post('/generate-gif-signature', (req, res) => {
    handleGifGeneration(req, res, false);
});

// Rota específica para a Trilha (com QR Code)
app.post('/generate-trilha-signature', (req, res) => {
    handleGifGeneration(req, res, true);
});

// Rota de teste de conexão (GET) - Mantida para debug
app.get('/test-connection', (req, res) => {
    console.log("Recebido pedido de teste de conexão!");
    res.json({
        status: "ok",
        message: "Conexão com o backend Railway funcionando!"
    });
});

// Rota raiz para verificação (vRAILWAY-CORSFIX) - Atualizada para confirmar a versão
app.get('/', (req, res) => {
    res.send('PROVA: Servidor vRAILWAY-CORSFIX está no ar!');
});

// Inicia o servidor na porta definida pelo ambiente ou 3000
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});


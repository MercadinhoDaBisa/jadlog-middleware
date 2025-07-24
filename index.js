require('dotenv').config();
const express = require('express'); // <<<<<<< LINHA CORRIGIDA AQUI!
const axios = require('axios');
const crypto = require('crypto');
const https = require('https'); 

const app = express();

app.use(express.raw({ type: 'application/json' }));
app.use(express.json());

const agent = new https.Agent({
    rejectUnauthorized: false
});

// --- Variáveis de Ambiente ---
const YAMPI_SECRET_TOKEN = process.env.YAMPI_SECRET_TOKEN;
const JADLOG_TOKEN = process.env.JADLOG_TOKEN; 
const JADLOG_ID_EMPRESA = process.env.JADLOG_ID_EMPRESA; 
const JADLOG_CPF_CNPJ = process.env.JADLOG_CPF_CNPJ; 

app.post('/cotacao', async (req, res) => {
    console.log('Headers Recebidos:', req.headers);

    const yampiSignature = req.headers['x-yampi-hmac-sha256'];
    const requestBodyRaw = req.body;

    // --- Validação de Segurança Yampi ---
    if (!yampiSignature || !YAMPI_SECRET_TOKEN) {
        console.error('Erro de Segurança: Assinatura Yampi ou Chave Secreta ausente.');
        return res.status(401).json({ error: 'Acesso não autorizado.' });
    }

    let calculatedSignature;
    try {
        const hmac = crypto.createHmac('sha256', YAMPI_SECRET_TOKEN);
        const parsedBody = JSON.parse(requestBodyRaw.toString('utf8'));
        const normalizedBodyString = JSON.stringify(parsedBody);
        hmac.update(normalizedBodyString);
        calculatedSignature = hmac.digest('base64');
    } catch (error) {
        console.error('Erro ao calcular a assinatura HMAC:', error.message);
        return res.status(500).json({ error: 'Erro interno na validação de segurança.' });
    }

    if (calculatedSignature !== yampiSignature) {
        console.error('Erro de Segurança: Assinatura Yampi inválida. Calculada:', calculatedSignature, 'Recebida:', yampiSignature);
        return res.status(401).json({ error: 'Acesso não autorizado. Assinatura Yampi inválida.' });
    }

    console.log('Validação de segurança Yampi: SUCESSO!');

    try {
        const yampiData = JSON.parse(requestBodyRaw.toString('utf8'));
        console.log('Payload Yampi Recebido:', JSON.stringify(yampiData, null, 2));

        const cepOrigem = "30720404"; 
        const cepDestino = yampiData.zipcode ? yampiData.zipcode.replace(/\D/g, '') : null;
        const valorDeclarado = yampiData.amount || 0;

        let pesoTotal = 0;
        let qtdeVolumeTotal = 0;

        if (yampiData.skus && Array.isArray(yampiData.skus)) {
            yampiData.skus.forEach(sku => {
                const pesoItem = sku.weight || 0;
                const quantidadeItem = sku.quantity || 1;
                
                pesoTotal += pesoItem * quantidadeItem;
                qtdeVolumeTotal += quantidadeItem; 
            });
        }

        const opcoesFrete = [];

        // --- Cotação Jadlog ---
        try {
            const payloadJadlog = {
                "frete": [
                    {
                        "cepori": cepOrigem,
                        "cepdes": cepDestino,
                        "frap": null,
                        "peso": pesoTotal,
                        "cnpj": JADLOG_CPF_CNPJ, 
                        "conta": JADLOG_ID_EMPRESA, 
                        "contrato": null, 
                        "modalidade": 3, 
                        "tpentrega": "D", 
                        "tpseguro": "N", 
                        "vldeclarado": valorDeclarado,
                        "vlcoleta": 0 
                    },
                    {
                        "cepori": cepOrigem,
                        "cepdes": cepDestino,
                        "frap": null,
                        "peso": pesoTotal,
                        "cnpj": JADLOG_CPF_CNPJ,
                        "conta": JADLOG_ID_EMPRESA,
                        "contrato": null,
                        "modalidade": 5, 
                        "tpentrega": "D",
                        "tpseguro": "N",
                        "vldeclarado": valorDeclarado,
                        "vlcoleta": 0
                    }
                ]
            };

            console.log('Payload Jadlog Enviado:', JSON.stringify(payloadJadlog, null, 2));

            const jadlogApiUrl = `https://www.jadlog.com.br/embarcador/api/frete/valor`; 

            const responseJadlog = await axios.post(
                jadlogApiUrl,
                payloadJadlog,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${JADLOG_TOKEN}` 
                    },
                    httpsAgent: agent 
                }
            );

            if (responseJadlog.data && Array.isArray(responseJadlog.data.frete)) {
                responseJadlog.data.frete.forEach(freteItem => {
                    if (freteItem.modalidade && freteItem.vlrTotal && freteItem.prazo) {
                        let serviceName = `Jadlog ${freteItem.modalidade}`; 
                        if (freteItem.modalidade === 3) serviceName = "Jadlog Rodoviário";
                        if (freteItem.modalidade === 5) serviceName = "Jadlog Expresso";

                        opcoesFrete.push({
                            "name": serviceName,
                            "service": `Jadlog_${freteItem.modalidade}`,
                            "price": freteItem.vlrTotal,
                            "days": freteItem.prazo,
                            "quote_id": `jadlog_cotacao_${freteItem.modalidade}`
                        });
                    } else if (freteItem.status && freteItem.status.msg) {
                        console.warn(`Jadlog: Erro na modalidade ${freteItem.modalidade}: ${freteItem.status.msg}`);
                    }
                });
                console.log('Cotação Jadlog SUCESSO! Opções encontradas:', opcoesFrete.length);
            } else {
                console.warn('Resposta da Jadlog não contém dados de frete esperados ou está vazia:', JSON.stringify(responseJadlog.data, null, 2));
            }

        } catch (error) {
            console.error('Erro na requisição Jadlog ou processamento:', error.message);
            if (error.response && error.response.data) {
                console.error('Detalhes do erro da Jadlog:', error.response.data);
            }
        }

        const respostaFinalYampi = {
            "quotes": opcoesFrete
        };

        console.log('Resposta FINAL enviada para Yampi:', JSON.stringify(respostaFinalYampi, null, 2));
        res.json(respostaFinalYampi);

    } catch (erro) {
        console.error('Erro geral no processamento do webhook:', erro.message);
        return res.status(500).json({ erro: 'Erro interno no servidor de cotação.' });
    }
});

app.get('/', (req, res) => {
    res.send('Middleware da Jadlog rodando');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
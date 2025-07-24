require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const https = require('https'); 

const app = express();

app.use(express.raw({ type: 'application/json' }));
app.use(express.json());

// Agente HTTPS para ignorar validação de certificado (útil para alguns ambientes ou APIs)
const agent = new https.Agent({
    rejectUnauthorized: false
});

// As variáveis de ambiente serão acessadas diretamente via process.env.<NOME_DA_VARIAVEL>

app.post('/cotacao', async (req, res) => {
    console.log('Headers Recebidos:', req.headers);

    const yampiSignature = req.headers['x-yampi-hmac-sha256'];
    const requestBodyRaw = req.body;

    // --- Validação de Segurança Yampi ---
    // Usando YAMPI_SECRET_TOKEN diretamente do process.env
    if (!yampiSignature || !process.env.YAMPI_SECRET_TOKEN) {
        console.error('Erro de Segurança: Assinatura Yampi ou Chave Secreta ausente.');
        return res.status(401).json({ error: 'Acesso não autorizado.' });
    }

    let calculatedSignature;
    try {
        const hmac = crypto.createHmac('sha256', process.env.YAMPI_SECRET_TOKEN);
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

        const cepOrigem = "30720404"; // CEP de origem fixo
        const cepDestino = yampiData.zipcode ? yampiData.zipcode.replace(/\D/g, '') : null;
        const valorDeclarado = yampiData.amount || 0;

        let pesoTotal = 0;

        if (yampiData.skus && Array.isArray(yampiData.skus)) {
            yampiData.skus.forEach(sku => {
                const pesoItem = sku.weight || 0;
                const quantidadeItem = sku.quantity || 1;
                pesoTotal += pesoItem * quantidadeItem;
            });
        }

        const opcoesFrete = [];

        // --- Cotação Jadlog ---
        try {
            // Ajustando tpentrega com base em TIPO_FRETE (assumindo '0' para Domiciliar 'D')
            const tipoEntrega = process.env.TIPO_FRETE === '0' ? 'D' : 'P'; 
            
            const payloadJadlog = {
                "frete": [
                    {
                        "cepori": cepOrigem,
                        "cepdes": cepDestino,
                        "frap": null, 
                        "peso": pesoTotal,
                        "cnpj": process.env.JADLOG_USER, // Usando JADLOG_USER diretamente do process.env
                        "conta": process.env.COD_CLIENTE, // Usando COD_CLIENTE diretamente do process.env
                        "contrato": null, 
                        "modalidade": parseInt(process.env.MODALIDADE), // Usando MODALIDADE diretamente do process.env
                        "tpentrega": tipoEntrega, 
                        "tpseguro": "N", // Tipo de seguro (N = Normal, A = Apólice)
                        "vldeclarado": valorDeclarado,
                        "vlcoleta": 0 
                    },
                    // Adicionando a modalidade 5 (Expresso) como uma segunda opção para demonstração
                    {
                        "cepori": cepOrigem,
                        "cepdes": cepDestino,
                        "frap": null,
                        "peso": pesoTotal,
                        "cnpj": process.env.JADLOG_USER,
                        "conta": process.env.COD_CLIENTE,
                        "contrato": null,
                        "modalidade": 5, // Jadlog Expresso
                        "tpentrega": tipoEntrega,
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
                        'Authorization': `Bearer ${process.env.JADLOG_TOKEN}` // Usando JADLOG_TOKEN diretamente do process.env
                    },
                    httpsAgent: agent 
                }
            );

            // Resposta da Jadlog é um array de objetos de frete
            if (responseJadlog.data && Array.isArray(responseJadlog.data.frete)) {
                responseJadlog.data.frete.forEach(freteItem => {
                    // Verifica se a cotação foi bem-sucedida para esta modalidade
                    if (freteItem.modalidade && freteItem.vlrTotal !== undefined && freteItem.prazo !== undefined) {
                        let serviceName = `Jadlog Modalidade ${freteItem.modalidade}`; 
                        if (freteItem.modalidade === 3) serviceName = "Jadlog Rodoviário";
                        if (freteItem.modalidade === 5) serviceName = "Jadlog Expresso";
                        // Adicione mais mapeamentos para outras modalidades se necessário

                        opcoesFrete.push({
                            "name": serviceName,
                            "service": `Jadlog_${freteItem.modalidade}`,
                            "price": freteItem.vlrTotal,
                            "days": freteItem.prazo,
                            "quote_id": `jadlog_cotacao_${freteItem.modalidade}`
                        });
                    } else if (freteItem.status && freteItem.status.msg) {
                        // Loga erros específicos para cada modalidade se houver
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
                console.error('Detalhes do erro da Jadlog:', JSON.stringify(error.response.data, null, 2));
            } else {
                console.error('Nenhum detalhe de resposta de erro da Jadlog disponível.');
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

// Usando PORT diretamente do process.env
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
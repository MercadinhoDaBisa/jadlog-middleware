require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(express.json());

const agent = new https.Agent({
  rejectUnauthorized: false
});

app.post('/cotacao', async (req, res) => {
  try {
    const {
      totPeso,
      totValor,
      des,
      volume
    } = req.body;

    const payload = {
      codCliente: process.env.COD_CLIENTE,
      conteudo: "PRODUTO DIVERSO",
      pedido: ["pedido123"],
      totPeso,
      totValor,
      obs: "Pedido enviado pela API",
      modalidade: parseInt(process.env.MODALIDADE),
      contaCorrente: process.env.CONTA_CORRENTE || null,
      tpColeta: "K", 
      tipoFrete: parseInt(process.env.TIPO_FRETE),
      cdUnidadeOri: "1",
      cdUnidadeDes: null,
      cdPickupOri: null,
      cdPickupDes: null,
      nrContrato: null,
      servico: 1,
      shipmentId: null,
      vlColeta: null,
      
      rem: {
        nome: "Mercadinho da Bisa",
        cnpjCpf: "59554346000184",
        ie: null,
        endereco: "Rua Progresso",
        numero: "280",
        compl: null,
        bairro: "Padre Eustáquio",
        cidade: "Belo Horizonte",
        uf: "MG",
        cep: "30720404",
        fone: "3171355339",
        cel: "3171355339",
        email: "mercadinhodabisa@gmail.com",
        contato: "Mercadinho da Bisa"
      },
      des: {
        ...des,
        ie: des.ie || null,
        compl: des.compl || null
      },
      dfe: [
        {
          "cfop": "0",
          "danfeCte": "0000000000000000000000000000000000000000",
          "nrDoc": "000000",
          "serie": "1",
          "tpDocumento": 0,
          "valor": totValor
        }
      ],
      volume: volume.map(vol => ({
          ...vol,
          identificador: vol.identificador || "PADRAO_VOLUME"
      }))
    };

    const resposta = await axios.post(
      'https://www.jadlog.com.br/embarcador/api/pedido/incluir',
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.JADLOG_TOKEN}`,
          'Content-Type': 'application/json'
        },
        httpsAgent: agent
      }
    );

    res.json(resposta.data);
  } catch (erro) {
    console.error('Erro na requisição:', erro.message);
    if (erro.response && erro.response.data) {
        console.error('Detalhes do erro da Jadlog:', erro.response.data);
        return res.status(erro.response.status).json({ erro: erro.response.data });
    }
    return res.status(500).json({ erro: erro.message });
  }
});

app.get('/', (req, res) => {
  res.send('Middleware da JadLog rodando');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

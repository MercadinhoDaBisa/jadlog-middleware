require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

app.post('/envio-pedido', async (req, res) => {
  try {
    const dadosYampi = req.body;

    const payload = {
      codCliente: process.env.COD_CLIENTE,
      contaCorrente: process.env.CONTA_CORRENTE,
      pedido: [dadosYampi.numero || "pedido-sem-numero"],
      totPeso: dadosYampi.peso || 0.4,
      totValor: dadosYampi.valor || 56.05,
      modalidade: parseInt(process.env.MODALIDADE),
      tipoFrete: parseInt(process.env.TIPO_FRETE),
      tipoColeta: "package",

      rem: {
        nome: "Mercadinho da Bisa",
        endereco: "Rua Progresso, 280",
        bairro: "Padre Eustáquio",
        cidade: "Belo Horizonte",
        uf: "MG",
        cep: "30720404",
        cnpjCpf: "59554346000184"
      },

      des: {
        nome: dadosYampi.nome_destinatario || "Destinatário",
        endereco: dadosYampi.endereco_destino || "Endereço destino",
        bairro: dadosYampi.bairro_destino || "Bairro destino",
        cidade: dadosYampi.cidade_destino || "Cidade destino",
        uf: dadosYampi.uf_destino || "UF",
        cep: dadosYampi.cep_destino || "88010140",
        cnpjCpf: dadosYampi.cpf_destinatario || "00000000000"
      },

      volume: [
        {
          peso: dadosYampi.peso || 0.4,
          altura: dadosYampi.altura || 10,
          largura: dadosYampi.largura || 10,
          comprimento: dadosYampi.comprimento || 10,
dfe: [
{
serie: "1"
numero: "123456"
valor: dadosYampi.valor || 100.0
}
]
          vlrMerc: dadosYampi.valor || 56.05
        }
      ]
    };

    const resposta = await axios.post(
      'https://www.jadlog.com.br/embarcador/api/pedido/incluir',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
'Authorization': `Bearer ${process.env.JADLOG_TOKEN}`
        }
      }
    );

    return res.status(200).json({ sucesso: true, resposta: resposta.data 
});

  } catch (erro) {
    return res.status(500).json({ erro: erro.message });
  }
});

app.get('/', (req, res) => {
  res.send('Middleware da JadLog rodando');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⁠ervidor rodando na porta ${PORT}}⁠`));

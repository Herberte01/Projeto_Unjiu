# Plataforma UMJIU

Site da União Mineira dos Jovens das Igrejas Unida, com inscrição on-line em eventos e um painel administrativo para publicar eventos, fotos, vídeos e avisos sem mexer em código.

## Como rodar

Precisa do Node.js 22.13 ou mais novo.

```bash
npm install
npm start
```

- Site: http://localhost:3000
- Painel: http://localhost:3000/admin

No primeiro acesso o sistema cria o administrador. Se o arquivo `.env` não tiver `ADMIN_PASSWORD`, uma senha é gerada e gravada no próprio `.env` (veja `.env.example`). Troque a senha em **Configurações** no painel.

O banco também nasce com o conteúdo de demonstração da versão de validação (três eventos, quatro mensagens, três avisos). Edite ou exclua pelo painel; para começar vazio, use `SEED_DEMO=0`.

## O que tem

**Site público** (`public/`)
- Página inicial com a última mensagem, carrossel de destaques arrastável, fita de fotos, mural e contagem regressiva do próximo evento.
- Cabeçalho flutuante que some ao descer e volta ao subir, menu em tela cheia, animações de entrada ao rolar.
- Eventos com página de detalhes e inscrição em três passos (dados, pagamento, confirmação).
- Preenchimento automático para quem já participou: exige CPF **e** data de nascimento, e só usa dados de quem autorizou guardá-los (LGPD).
- Mensagens do YouTube tocando em uma janela sobre a página, galeria de fotos com visualização ampliada (teclado e gesto de arrastar no celular).

**Painel** (`public/admin/`)
- Eventos: datas, local, valor, parcelas no Pix, vagas, foto de capa, rascunho/publicado.
- Inscrições: busca, filtro por evento e situação, marcar como pago, planilha CSV.
- Fotos: crie um álbum e arraste várias fotos de uma vez. Elas são reduzidas no navegador antes do envio.
- Vídeos: cole o link do YouTube e o título e a capa são preenchidos sozinhos.
- Mural e Configurações (textos da página inicial, contatos, redes, chave Pix, senha).

## Pagamento

Não há gateway de pagamento integrado. Ao concluir a inscrição o participante vê a chave Pix cadastrada em Configurações e o plano de parcelas; a diretoria confere o pagamento e marca a inscrição como paga no painel. Cartão e boleto aparecem como "em breve".

## Estrutura

```
server/index.js   API, login do painel e envio de imagens (Express)
server/db.js      banco SQLite (módulo node:sqlite), tabelas e dados iniciais
public/           site público (HTML, CSS e JS sem etapa de build)
public/admin/     painel administrativo
data/             banco e fotos enviadas (criado ao rodar; fora do Git)
```

## Publicar

É uma aplicação Node com arquivos em disco, então a hospedagem precisa manter a pasta `data/` entre reinícios (VPS, ou serviço com disco persistente). Em produção defina:

```
NODE_ENV=production
TRUST_PROXY=1        # se estiver atrás de proxy/HTTPS
DATA_DIR=/caminho/do/disco/persistente
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
```

Faça cópia de segurança periódica da pasta `data/`: ela contém as inscrições e as fotos.

# Happy — Trabalho Web UCB

Projeto de interface web para cadastrar instituições de acolhimento e consultar suas informações de visitação. Desenvolvido por [Marcos Aurélio](https://github.com/MarcosAAurelio), com base nas referências visuais [`image.png`](image.png) e [`image copy.png`](image%20copy.png).

O projeto usa **HTML, CSS, JavaScript e Bootstrap 5.3.8**, sem etapa de compilação ou instalação de pacotes. Os arquivos oficiais do Bootstrap estão incluídos localmente em `assets/vendor/bootstrap/`.

Repositório: [MarcosAAurelio/Trabalho-web-UCB](https://github.com/MarcosAAurelio/Trabalho-web-UCB).

## Funcionalidades

- Página inicial com a identidade visual do Happy.
- Mapa interativo com marcadores, zoom, navegação e busca pelo nome das instituições cadastradas.
- Cadastro com seleção de localização pelo mapa ou preenchimento manual de latitude e longitude.
- Validação dos dados obrigatórios, do telefone e das coordenadas.
- Envio e prévia de até seis fotos JPEG, PNG ou WebP, com até 5 MB por arquivo. As imagens são redimensionadas antes de serem salvas.
- Página de detalhes com informações de visitação, carrossel de fotos e link para contato pelo WhatsApp.
- Layout responsivo para celulares, tablets e computadores.

## Como executar

### Com Live Server

1. Baixe ou clone este repositório.
2. Abra a pasta do projeto no Visual Studio Code.
3. Instale a extensão **Live Server**, de Ritwick Dey.
4. Clique com o botão direito em `index.html` e escolha **Open with Live Server**.

### Com Node.js

Se você já tiver Node.js instalado, abra um terminal na pasta do projeto e execute:

```powershell
node server.js
```

Acesse [http://localhost:3333](http://localhost:3333). Para encerrar o servidor, pressione `Ctrl+C`. O servidor é opcional, usa apenas módulos nativos do Node.js e não exige `npm install`.

Também é possível abrir `index.html` diretamente no navegador. Para usar os mapas online e manter o armazenamento dos cadastros no mesmo endereço, execute o projeto por um servidor HTTP, como o Live Server ou o servidor incluído.

## Estrutura principal

```text
Trabalho-web-UCB/
├── index.html                 # Página inicial
├── orphanages.html            # Mapa, busca e lista de instituições
├── create-orphanage.html      # Formulário de cadastro
├── orphanage.html             # Detalhes de uma instituição
├── styles.css                 # Tema Happy e estilos responsivos
├── scripts/
│   └── app.js                 # Mapas, validação, cadastro e interações
├── assets/
│   ├── vendor/bootstrap/      # Bootstrap oficial e sua licença
│   ├── SOURCES.md             # Origem e atribuição dos assets
│   └── ...                   # Ilustrações, ícones, fonte e licenças
├── server.js                  # Servidor local opcional
├── .nojekyll                  # Publicação dos arquivos estáticos no Pages
├── image.png                  # Referência visual da página inicial
└── image copy.png             # Referência visual do formulário
```

## Uso do Bootstrap

O framework participa da estrutura e das interações do projeto:

- **Grade responsiva:** `container-fluid`, `row` e `col-*` organizam a página do mapa, os campos de coordenadas e os cartões de visitação.
- **Formulários e validação:** `form-control`, `form-label`, `form-switch`, `is-invalid` e `invalid-feedback` compõem os controles e suas mensagens de erro.
- **Botões e listas:** classes `btn` e `list-group` são usadas nas ações e na listagem das instituições.
- **Collapse:** mostra e oculta os campos de coordenadas manuais.
- **Carousel:** controla a galeria de fotos com botões, miniaturas, teclado e toque, sem avanço automático.

O CSS do Bootstrap é carregado antes de `styles.css`, que personaliza a tipografia, as cores e a composição do Happy. O bundle JavaScript do framework é carregado antes de `scripts/app.js`.

## Armazenamento e serviços externos

Os cadastros e as fotos ficam no **localStorage do navegador**, na chave `happy.orphanages.v1`. Este é um projeto de frontend: não há servidor de dados nem compartilhamento de cadastros entre usuários, dispositivos, navegadores ou endereços de acesso. Limpar os dados do navegador remove os registros. A listagem começa vazia, sem instituições fictícias.

As fotos convertidas ocupam o espaço disponível no localStorage. O projeto limita o total de imagens de cada cadastro e apresenta uma mensagem caso o navegador não consiga salvar os dados.

Os mapas usam imagens do **OpenStreetMap** e precisam de internet e de uma página servida por HTTP ou HTTPS. Se o mapa não carregar, o formulário permite informar as coordenadas manualmente. A localização atual depende da permissão concedida ao navegador e de HTTPS ou `localhost`. O contato por WhatsApp abre um serviço externo e também requer conexão.

Para usar o mapa pelo teclado, mova o foco até ele e pressione as setas para navegar; no formulário, pressione `Enter` para selecionar a localização.

## GitHub Pages (opcional)

Após enviar o projeto ao GitHub, é possível habilitar a hospedagem estática:

1. No repositório, abra **Settings → Pages**.
2. Em **Build and deployment**, escolha **Deploy from a branch**.
3. Selecione a branch **main** e a pasta **/ (root)**.
4. Clique em **Save** e aguarde a conclusão da publicação.

O endereço de acesso será informado pelo próprio GitHub nessa tela. Não é necessário executar `server.js` no GitHub Pages. Os cadastros continuarão sendo locais ao navegador de cada visitante.

## Referências e licenças

As imagens de referência `image.png` e `image copy.png` foram preservadas com seus nomes originais.

- A ilustração e os ícones do Happy vêm do projeto educacional [Happy / NLW 3 da Rocketseat](https://github.com/rocketseat-education/nlw-03-discovery). A licença MIT dos assets está em [assets/HAPPY-LICENSE.md](assets/HAPPY-LICENSE.md).
- A fonte [Nunito](https://fonts.google.com/specimen/Nunito) é distribuída sob a SIL Open Font License, incluída em [assets/NUNITO-LICENSE.txt](assets/NUNITO-LICENSE.txt).
- O [Bootstrap 5.3.8](https://getbootstrap.com/docs/5.3/getting-started/introduction/) é distribuído sob a licença MIT, incluída em [assets/vendor/bootstrap/LICENSE](assets/vendor/bootstrap/LICENSE).
- Os mapas exibem a atribuição ao [OpenStreetMap](https://www.openstreetmap.org/copyright) e usam seus tiles conforme a [política de uso](https://operations.osmfoundation.org/policies/tiles/).

As origens e os arquivos de terceiros estão detalhados em [assets/SOURCES.md](assets/SOURCES.md). As licenças citadas se referem aos respectivos materiais de terceiros.
